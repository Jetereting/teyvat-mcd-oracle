#!/usr/bin/env node
/**
 * 自测（零依赖，node scripts/selftest.mjs 即可跑）
 *
 * 重点覆盖两类「看起来没问题、其实错了」的地方：
 *  1. 券作用域判定 —— 只有折扣率、没有门槛、没有商品码的券（如「咖啡类5折」）
 *     绝不能被当成整单折扣，否则估算会翻倍虚高。
 *  2. 券组合优化 —— 用暴力枚举做交叉验证，确保剪枝搜索真的找到最优解。
 */

import { parseTeam, parseElement, reactionOf, buildPartyOrder, candidatesForElement, scoreForElement } from './elemental.mjs';
import { normalizeCoupons, optimizeCart } from './artifact.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    process.stdout.write(`  \x1b[32m✔\x1b[0m ${name}\n`);
  } else {
    failed++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    process.stdout.write(`  \x1b[31m✘\x1b[0m ${name}${extra ? '  ' + extra : ''}\n`);
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function group(title) {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

// ------------------------------------------------------------------ 1. 元素引擎

group('元素解析与反应');

eq('parseTeam("火,冰")', parseTeam('火,冰'), ['pyro', 'cryo']);
eq('parseTeam("pyro 水 雷")', parseTeam('pyro 水 雷'), ['pyro', 'hydro', 'electro']);
eq('parseTeam 去重', parseTeam('火,火元素,pyro'), ['pyro']);
eq('parseElement("风系")', parseElement('风系'), 'anemo');
ok('parseElement 未知返回 null', parseElement('光明元素') === null);
eq('火+冰 → 融化', reactionOf(['pyro', 'cryo']).name, '融化');
eq('水+雷 → 元素共鸣兜底', reactionOf(['hydro', 'electro']).name, '元素共鸣');
ok('单元素返回单元素共鸣', reactionOf(['geo']).name === '单元素共鸣');

// ------------------------------------------------------------------ 2. 关键词匹配

group('餐品 → 元素匹配');

ok('麦辣鸡腿堡 命中火', scoreForElement('麦辣鸡腿堡', 'pyro') >= 10);
ok('奥利奥麦旋风 命中冰', scoreForElement('奥利奥麦旋风', 'cryo') >= 5);
ok('拿铁咖啡 命中雷', scoreForElement('拿铁咖啡', 'electro') >= 5);
ok('巨无霸 命中岩', scoreForElement('巨无霸', 'geo') >= 5);
ok('矿泉水 命中水', scoreForElement('矿泉水', 'hydro') >= 1);

const meals = [
  { code: '1', name: '麦辣鸡腿堡', price: 2550 },
  { code: '2', name: '原味甜筒', price: 600 },
  { code: '3', name: '可口可乐（中）', price: 950 },
  { code: '4', name: '拿铁咖啡', price: 1850 },
];
const cands = candidatesForElement(meals, 'pyro');
eq('火元素只筛出辣味主菜', cands.map((c) => c.name), ['麦辣鸡腿堡']);

const plan = buildPartyOrder(meals, ['pyro', 'cryo'], {});
ok('组队包含主菜', plan.picks.some((p) => p.meal.code === '1'));
ok('组队包含甜品', plan.picks.some((p) => p.meal.code === '2'));
ok('原价合计正确', plan.originalCents === plan.picks.reduce((s, p) => s + p.meal.price, 0));

const budgeted = buildPartyOrder(meals, ['pyro', 'cryo'], { budgetCents: 3200 });
ok('预算裁剪生效', budgeted.originalCents <= 3200, `实际 ${budgeted.originalCents}`);
ok('预算裁剪不砍掉主菜', budgeted.picks.some((p) => p.meal.code === '1'));

// ------------------------------------------------------------------ 3. 券作用域（回归测试）

group('券作用域判定（回归）');

const coupons = normalizeCoupons([
  { couponId: 'A', name: '满30元减5元', minAmount: 30, discountAmount: 5 },
  { couponId: 'B', name: '巨无霸立减8元', productCodes: ['1001'], discountAmount: 8 },
  { couponId: 'C', name: '咖啡类5折', discountRate: 0.5 },
  { couponId: 'D', name: '会员立减3元', discountAmount: 3 },
]);

eq('满减券 → 整单券', coupons[0].scope, 'order');
eq('满减券门槛换算为分', coupons[0].minAmountCents, 3000);
eq('指定商品券 → 商品券', coupons[1].scope, 'product');
ok('指定商品券不是 uncertain', coupons[1].uncertain === false);

// ↓↓ 这条就是当初的真 bug：把它判成 order 会让整单打 5 折，¥59.50 被压到 ¥28.75
eq('无门槛纯折扣券 → 商品券（不是整单券）', coupons[2].scope, 'product');
ok('无门槛纯折扣券标记为 uncertain', coupons[2].uncertain === true);

eq('无门槛定额券 → 通配商品券', coupons[3].scope, 'product');
ok('无门槛定额券不是 uncertain', coupons[3].uncertain === false);

// ------------------------------------------------------------------ 4. 优化器 vs 暴力枚举

group('券组合优化 vs 暴力枚举');

/** 与引擎同一套折扣语义的暴力解，用作 ground truth */
function bruteForce(cart, cps) {
  let best = Infinity;
  const n = cart.length;
  // 每张券的归宿：-1 不用 / i 挂在第 i 行 / n 表示作为整单券
  const assign = new Array(cps.length).fill(-1);

  const evalPlan = () => {
    const linePay = cart.map((l) => l.unitPriceCents * l.quantity);
    let orderIdx = -1;
    for (let k = 0; k < cps.length; k++) {
      const t = assign[k];
      if (t < 0) continue;
      const c = cps[k];
      if (t === n) {
        if (orderIdx !== -1) return Infinity; // 只允许一张整单券
        if (c.scope !== 'order') return Infinity;
        orderIdx = k;
        continue;
      }
      if (c.scope !== 'product' || c.uncertain) return Infinity;
      if (c.productCodes.length && !c.productCodes.includes(String(cart[t].productCode))) return Infinity;
      if (linePay[t] < 0) return Infinity;
    }
    const usedLines = new Set();
    for (let k = 0; k < cps.length; k++) {
      const t = assign[k];
      if (t < 0 || t === n) continue;
      if (usedLines.has(t)) return Infinity;
      usedLines.add(t);
      const c = cps[k];
      const gross = linePay[t];
      linePay[t] = c.discountCents
        ? Math.max(0, gross - c.discountCents)
        : c.discountRate !== null
          ? Math.max(0, Math.round(gross * c.discountRate))
          : gross;
    }
    let sub = linePay.reduce((a, b) => a + b, 0);
    if (orderIdx !== -1) {
      const c = cps[orderIdx];
      const meets = !c.minAmountCents || sub >= c.minAmountCents;
      if (!meets) return Infinity;
      sub = c.discountCents ? Math.max(0, sub - c.discountCents) : c.discountRate !== null ? Math.max(0, Math.round(sub * c.discountRate)) : sub;
    }
    return sub;
  };

  const rec = (k) => {
    if (k === cps.length) {
      best = Math.min(best, evalPlan());
      return;
    }
    for (let t = -1; t <= n; t++) {
      assign[k] = t;
      rec(k + 1);
    }
    assign[k] = -1;
  };
  rec(0);
  return best;
}

// 固定种子的 LCG，保证可复现
let seed = 20261011;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const pool = [
  { couponId: 'C1', couponCode: 'X1', name: '满30减5', minAmount: 30, discountAmount: 5 },
  { couponId: 'C2', couponCode: 'X2', name: '满50减12', minAmount: 50, discountAmount: 12 },
  { couponId: 'C3', couponCode: 'X3', name: '巨无霸减8', productCodes: ['1001'], discountAmount: 8 },
  { couponId: 'C4', couponCode: 'X4', name: '中薯减5', productCodes: ['2001'], discountAmount: 5 },
  { couponId: 'C5', couponCode: 'X5', name: '饮品5折', discountRate: 0.5 },
  { couponId: 'C6', couponCode: 'X6', name: '甜品3折', productCodes: ['3001'], discountRate: 0.3 },
];

const menuPool = [
  { productCode: '1001', name: '巨无霸', unitPriceCents: 2550 },
  { productCode: '2001', name: '薯条（中）', unitPriceCents: 1200 },
  { productCode: '3001', name: '原味甜筒', unitPriceCents: 600 },
  { productCode: '4005', name: '拿铁咖啡', unitPriceCents: 1850 },
];

let cases = 0;
let mismatches = 0;
for (let iter = 0; iter < 300; iter++) {
  const cartSize = 1 + Math.floor(rnd() * 3);
  const cart = [];
  for (let i = 0; i < cartSize; i++) {
    const m = menuPool[Math.floor(rnd() * menuPool.length)];
    cart.push({ id: `L${i}`, productCode: m.productCode, name: m.name, unitPriceCents: m.unitPriceCents, quantity: 1 + Math.floor(rnd() * 2) });
  }
  const cpCount = 1 + Math.floor(rnd() * 4);
  const picked = [];
  const usedIdx = new Set();
  while (picked.length < cpCount) {
    const k = Math.floor(rnd() * pool.length);
    if (usedIdx.has(k)) continue;
    usedIdx.add(k);
    picked.push(pool[k]);
  }
  const cps = normalizeCoupons(picked);
  const got = optimizeCart(cart, cps, { topK: 1, maxNodes: 500000 }).plans[0].finalCents;
  const want = bruteForce(cart, cps);
  cases++;
  if (got !== want) {
    mismatches++;
    if (mismatches <= 3) {
      process.stdout.write(
        `    差异：cart=${cart.map((c) => `${c.productCode}x${c.quantity}`).join(',')} ` +
          `coupons=${picked.map((p) => p.name).join('|')} 引擎=${got} 暴力=${want}\n`,
      );
    }
  }
}
ok(`300 组随机用例与暴力枚举一致（实际比较 ${cases} 组）`, mismatches === 0, `不一致 ${mismatches} 组`);

// 手工用例：整单券与商品券同时存在时，取更优的那个
const cartA = [
  { id: 'L0', productCode: '1001', name: '巨无霸', unitPriceCents: 2550, quantity: 2 },
  { id: 'L1', productCode: '2001', name: '薯条（中）', unitPriceCents: 1200, quantity: 1 },
];
const cpsA = normalizeCoupons([
  { couponId: 'A1', couponCode: 'A1', name: '满50减12', minAmount: 50, discountAmount: 12 },
  { couponId: 'A2', couponCode: 'A2', name: '巨无霸减8', productCodes: ['1001'], discountAmount: 8 },
]);
const rA = optimizeCart(cartA, cpsA, { topK: 2 });
// 单品券与整单券是两张不同的券，可以叠加：巨无霸行 5100-800=4300，小计 5500 仍满足满50门槛，
// 再减 12 元 → 4300。这条同时也锁住了「叠加语义」不被后续改动悄悄改掉。
eq('单品券 + 整单券可叠加，取到最优 ¥43.00', rA.plans[0].finalCents, 4300, `期望 4300，实际 ${rA.plans[0].finalCents}`);
ok('原价计算正确', rA.originalCents === 6300, `实际 ${rA.originalCents}`);
ok('叠加方案省 2000 分', rA.plans[0].savedCents === 2000, `实际 ${rA.plans[0].savedCents}`);

// 门槛不满足时不误用
const cartB = [{ id: 'L0', productCode: '1001', name: '巨无霸', unitPriceCents: 2550, quantity: 1 }];
const cpsB = normalizeCoupons([{ couponId: 'B1', couponCode: 'B1', name: '满50减12', minAmount: 50, discountAmount: 12 }]);
eq('门槛不满足则不折扣', optimizeCart(cartB, cpsB, { topK: 1 }).plans[0].finalCents, 2550);

// uncertain 券不参与本地搜索
const cpsC = normalizeCoupons([{ couponId: 'C1', couponCode: 'C1', name: '咖啡5折', discountRate: 0.5 }]);
const rC = optimizeCart(cartB, cpsC, { topK: 1 });
eq('uncertain 券不参与本地估价', rC.plans[0].finalCents, 2550);
ok('uncertain 券被单独列出待探测', rC.uncertainCoupons.length === 1);

// ------------------------------------------------------------------ 汇总

process.stdout.write(`\n${'─'.repeat(52)}\n`);
process.stdout.write(`通过 ${passed} 项，失败 ${failed} 项\n`);
if (failed) {
  process.stdout.write('\n失败明细：\n');
  failures.forEach((f) => process.stdout.write(`  · ${f}\n`));
  process.exit(1);
}
process.stdout.write('\x1b[32m全部通过\x1b[0m\n');
