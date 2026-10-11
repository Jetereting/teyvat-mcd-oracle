#!/usr/bin/env node
/**
 * 麦门祈愿 · 提瓦特冒险家点餐台（Teyvat McD Oracle）
 * 命令行主程序
 *
 * 用法速查：
 *   node scripts/oracle.mjs demo
 *   node scripts/oracle.mjs party --team 火,冰 --budget 50
 *   node scripts/oracle.mjs artifact --team 火,冰
 *   node scripts/oracle.mjs wish
 *   node scripts/oracle.mjs doctor
 *
 * 加 --demo 走离线演示数据；不加则连 https://mcp.mcd.cn（需 MCD_MCP_TOKEN）。
 */

import { McdMcpClient, McpError, parseToolPayload, unwrap, pick, deepFind, firstArray } from './mcp-client.mjs';
import {
  parseTeam,
  buildPartyOrder,
  candidatesForElement,
  mealName,
  mealCode,
  mealPriceCents,
  reactionOf,
  elementStyle,
  ELEMENT_ORDER,
} from './elemental.mjs';
import { normalizeCoupons, optimizeCart, couponRef, fmtYuan, centsToMora } from './artifact.mjs';
import * as R from './render.mjs';
import * as MOCK from './mock-data.mjs';

// ------------------------------------------------------------------ 参数解析

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const HELP = `
${R.USE_COLOR ? '\x1b[1m' : ''}麦门祈愿 · 提瓦特冒险家点餐台\x1b[0m

  node scripts/oracle.mjs <子命令> [选项]

子命令
  doctor                     连接器自检：Token、握手、可用工具数
  anchor                     传送锚点 —— 查询附近门店
  menu                       料理图鉴 —— 查询门店餐品
  party                      元素共鸣点单 —— 按队伍元素生成搭配
  artifact                   圣遗物强化 —— 优惠券组合最优解
  wish                       祈愿台 —— 积分祈愿信息（--draw 才真正祈愿）
  prizes                     祈愿记录 —— 我抽到过什么
  calendar                   活动秘境 —— 当月营销活动日历
  commission                 冒险家委托 —— 下单（默认仅预览）
  demo                       一键离线跑通全链路

通用选项
  --demo                     离线演示模式（虚构数据，无需 Token）
  --json                     以 JSON 输出，便于脚本消费
  --be-type <1|5>            1=到店自取（默认），5=得来速
  --city <城市>              配合 anchor 使用
  --keyword <地标>           配合 anchor 使用
  --store <storeCode>        指定门店
  --team <元素,元素>         队伍元素，如 火,冰 / pyro,hydro
  --budget <元>              预算上限（元）
  --cart <code xN,...>       购物车，如 1001x1,2001x2
  --deep                     扩大券组合搜索空间
  --bind-coupons             自动领取麦麦省可领券（会改动账号资产，需你确认再执行）
  --max-probes <n>           「适用范围未知」券的探测次数上限，默认 8
  --draw                     真正执行祈愿（需人工确认语义下的显式开关）
  --confirm                  真正提交订单（线上写操作！）
  --verbose                  打印核价 / 探测失败的细节

环境变量
  MCD_MCP_TOKEN              麦当劳 MCP Token（必填，除非 --demo）
  MCD_MCP_URL                默认 https://mcp.mcd.cn
`;

// ------------------------------------------------------------------ 运行时

function createRuntime({ demo }) {
  if (demo) return { demo: true, client: null };

  const token = process.env.MCD_MCP_TOKEN;
  const url = process.env.MCD_MCP_URL || undefined;
  if (!token) {
    throw new McpError(
      '未找到 MCD_MCP_TOKEN。\n' +
        '  · 想先看效果：加 --demo\n' +
        '  · 想连真实 MCP：export MCD_MCP_TOKEN="你的Token"',
      { stage: 'config' },
    );
  }
  return { demo: false, client: new McdMcpClient({ token, url }) };
}

async function withClient(rt, fn) {
  if (rt.demo) return await fn(null);
  await rt.client.connect();
  try {
    return await fn(rt.client);
  } finally {
    // 无状态 HTTP，无需显式关闭
  }
}

/** 带重试与「人话化」报错的 tool 调用 */
async function call(client, tool, args, { retries = 1 } = {}) {
  if (!client) throw new Error(`offline:${tool}`);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await client.callToolJson(tool, args);
    } catch (err) {
      lastErr = err;
      const retriable = /超时|网络|频繁|timeout|ECONN|HTTP 5\d\d/i.test(String(err.message));
      if (!retriable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ 数据适配

/** 门店（query-nearby-stores） */
async function fetchStores(rt, flags) {
  const beType = Number(flags['be-type'] ?? 1);
  if (rt.demo) {
    return MOCK.stores.filter((s) => s.beType === beType).length
      ? MOCK.stores.filter((s) => s.beType === beType)
      : MOCK.stores;
  }
  const searchType = flags.city || flags.keyword ? 2 : 1;
  const args = { beType, searchType };
  if (searchType === 2) {
    args.city = flags.city;
    args.keyword = flags.keyword;
  }
  const data = await call(rt.client, 'query-nearby-stores', args, { retries: 2 });
  return firstArray(data, ['stores', 'storeList', 'list', 'shopList']).map((s) => ({
    storeCode: String(pick(s, ['storeCode', 'code', 'shopCode'], '') || ''),
    storeName: pick(s, ['storeName', 'name', 'shopName'], '(未命名门店)'),
    address: pick(s, ['address', 'storeAddress', 'addr']),
    beCode: pick(s, ['beCode']),
    beType: Number(pick(s, ['beType'], beType)),
    reservation: Boolean(pick(s, ['reservation'], false)),
    reservationTimeOptions: pick(s, ['reservationTimeOptions'], []),
    today: Boolean(pick(s, ['today'], false)),
  }));
}

/** 餐品（query-meals） */
async function fetchMeals(rt, { storeCode, orderType, beType, beCode }) {
  if (rt.demo) return MOCK.meals;
  const args = { storeCode, orderType, beType };
  if (beType !== 1) args.beCode = beCode;
  const data = await call(rt.client, 'query-meals', args);
  const list = firstArray(data, ['meals', 'mealList', 'products', 'productList', 'list', 'data', 'categories']);
  const flat = [];
  const walk = (arr) => {
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const kids = pick(it, ['products', 'items', 'mealList', 'children']);
      if (Array.isArray(kids) && kids.length) walk(kids);
      const name = mealName(it);
      const code = mealCode(it);
      if (code && name && name !== '(未命名餐品)') flat.push(it);
    }
  };
  walk(list);
  return flat.length ? dedupe(flat) : list;
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter((m) => {
    const k = mealCode(m);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 购物车 → 统一行结构 */
function toCartLines(meals, spec) {
  const lines = [];
  for (const part of String(spec).split(/[,，]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([A-Za-z0-9_-]+)\s*[x×*]\s*(\d+)$/) ?? part.match(/^([A-Za-z0-9_-]+)$/);
    if (!m) continue;
    const code = m[1];
    const qty = Number(m[2] ?? 1);
    const meal = meals.find((x) => String(mealCode(x)) === String(code));
    const price = meal ? mealPriceCents(meal) : null;
    lines.push({
      productCode: code,
      name: meal ? mealName(meal) : `未知餐品(${code})`,
      unitPriceCents: price ?? 0,
      quantity: qty,
      priceKnown: price !== null,
    });
  }
  return lines;
}

/** 从 calculate-price 结果里挖出实付金额（分） */
function extractTotalCents(data) {
  if (!data || typeof data !== 'object') return null;
  const keys = [
    'totalAmount', 'payAmount', 'actualAmount', 'totalPrice', 'needPayAmount',
    'payPrice', 'total', 'amount', 'realAmount', 'orderAmount', 'payableAmount',
  ];
  for (const k of keys) {
    const v = Number(data[k]);
    if (Number.isFinite(v) && v > 0) return v >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 100);
  }
  const found = deepFind(data, (v) => typeof v === 'number' && Number.isFinite(v) && v > 0, { maxDepth: 4 });
  if (typeof found === 'number') return Math.round(found);
  return null;
}

function extractTakeWayList(data) {
  const arr = firstArray(data, ['takeWayList', 'takeWay', 'takeWayOptions']);
  return Array.isArray(arr) ? arr : [];
}

// ------------------------------------------------------------------ 子命令

async function cmdDoctor(flags, out) {
  const checks = [];
  const demo = Boolean(flags.demo);

  checks.push({
    name: 'MCD_MCP_TOKEN',
    ok: Boolean(process.env.MCD_MCP_TOKEN) || demo,
    detail: demo ? '离线模式，跳过' : process.env.MCD_MCP_TOKEN ? '已设置' : '未设置（export MCD_MCP_TOKEN=...）',
  });
  checks.push({
    name: 'MCP 地址',
    ok: true,
    detail: process.env.MCD_MCP_URL || 'https://mcp.mcd.cn',
  });
  checks.push({ name: 'Node 版本', ok: Number(process.versions.node.split('.')[0]) >= 18, detail: `v${process.versions.node}` });

  if (demo) {
    checks.push({ name: '握手 initialize', ok: true, detail: '离线模式，跳过' });
    checks.push({ name: 'tools/list', ok: true, detail: `离线模式，内置 ${MOCK_TOOL_COUNT} 个工具的知识` });
    return out.text(R.renderDoctor({ checks }));
  }

  if (!process.env.MCD_MCP_TOKEN) {
    checks.push({ name: '握手 initialize', ok: false, detail: '前置条件未满足' });
    checks.push({ name: 'tools/list', ok: false, detail: '前置条件未满足' });
    return out.text(R.renderDoctor({ checks }));
  }

  const rt = createRuntime({ demo: false });
  try {
    await rt.client.connect();
    checks.push({
      name: '握手 initialize',
      ok: true,
      detail: `serverInfo: ${rt.client.serverInfo?.name ?? '-'} ${rt.client.serverInfo?.version ?? ''}`,
    });
  } catch (err) {
    checks.push({ name: '握手 initialize', ok: false, detail: err.message });
    checks.push({ name: 'tools/list', ok: false, detail: '前置条件未满足' });
    return out.text(R.renderDoctor({ checks }));
  }

  try {
    const tools = await rt.client.listTools();
    const expect = ['query-nearby-stores', 'query-meals', 'calculate-price', 'create-order', 'query-store-coupons'];
    const missing = expect.filter((t) => !tools.some((x) => x.name === t));
    checks.push({
      name: 'tools/list',
      ok: tools.length > 0,
      detail: `发现 ${tools.length} 个工具${missing.length ? `；缺少常用工具 ${missing.join(',')}` : ''}`,
    });
  } catch (err) {
    checks.push({ name: 'tools/list', ok: false, detail: err.message });
  }
  return out(R.renderDoctor({ checks }));
}

const MOCK_TOOL_COUNT = 32;

async function cmdAnchor(rt, flags, out, ctx) {
  const team = parseTeam(flags.team);
  const stores = await withClient(rt, () => fetchStores(rt, flags));
  ctx.store = stores[0] ?? null;
  if (out.json) return out.raw({ stores, demo: rt.demo });
  return out.text(R.renderAnchors(stores, team) + R.footer(rt.demo ? MOCK.MOCK_NOTE : '数据来源：麦当劳 MCP query-nearby-stores'));
}

async function resolveStore(rt, flags, ctx) {
  if (ctx.store) return ctx.store;
  if (flags.store) {
    return { storeCode: String(flags.store), storeName: `指定门店 ${flags.store}`, beType: Number(flags['be-type'] ?? 1) };
  }
  const stores = await fetchStores(rt, flags);
  ctx.store = stores[0] ?? null;
  return ctx.store;
}

async function cmdMenu(rt, flags, out, ctx) {
  const beType = Number(flags['be-type'] ?? 1);
  const orderType = beType === 1 ? 1 : 2;
  return await withClient(rt, async () => {
    const store = await resolveStore(rt, flags, ctx);
    if (!store?.storeCode) throw new Error('没有可用门店，请先运行 anchor 或传 --store <storeCode>');
    const meals = await fetchMeals(rt, { storeCode: store.storeCode, orderType, beType: beType === 5 ? 5 : beType === 1 ? 1 : beType, beCode: store.beCode });
    ctx.meals = meals;
    const normalized = meals.map((m) => ({
      code: mealCode(m),
      name: mealName(m),
      price: mealPriceCents(m) ?? null,
      raw: m,
    }));
    if (out.json) return out.raw({ store, meals: normalized, demo: rt.demo });
    return out.text(
      R.renderMenu(normalized, parseTeam(flags.team)) +
        R.footer(`${store.storeName}（${store.storeCode}） · 数据来源：麦当劳 MCP query-meals`),
    );
  });
}

async function cmdParty(rt, flags, out, ctx) {
  const team = parseTeam(flags.team);
  if (!team.length) {
    throw new Error('请用 --team 指定队伍元素，例如 --team 火,冰（可选：火 水 风 雷 草 冰 岩）');
  }
  const budget = flags.budget ? Math.round(Number(flags.budget) * 100) : null;
  return await withClient(rt, async () => {
    const store = await resolveStore(rt, flags, ctx);
    const beType = Number(flags['be-type'] ?? 1);
    const meals =
      ctx.meals ??
      (await fetchMeals(rt, {
        storeCode: store.storeCode,
        orderType: beType === 1 ? 1 : 2,
        beType,
        beCode: store.beCode,
      }));
    const normalized = meals.map((m) => ({ code: mealCode(m), name: mealName(m), price: mealPriceCents(m), raw: m }));
    ctx.meals = normalized;
    const plan = buildPartyOrder(normalized, team, { budgetCents: budget });
    ctx.partyPlan = plan;

    if (out.json) {
      return out.raw({
        team,
        reaction: plan.reaction,
        picks: plan.picks.map((p) => ({ element: p.element, code: mealCode(p.meal), name: p.name, priceCents: mealPriceCents(p.meal) })),
        originalCents: plan.originalCents,
        store,
        demo: rt.demo,
      });
    }
    return out.text(
      R.renderPartyPlan(plan, { storeName: store?.storeName }) +
        R.footer(rt.demo ? MOCK.MOCK_NOTE : '数据来源：麦当劳 MCP query-meals + 本地元素共鸣引擎'),
    );
  });
}

async function cmdArtifact(rt, flags, out, ctx) {
  const team = parseTeam(flags.team);
  return await withClient(rt, async () => {
    const store = await resolveStore(rt, flags, ctx);
    const beType = Number(flags['be-type'] ?? 1);
    const orderType = beType === 1 || beType === 5 ? 1 : 2;

    let meals = ctx.meals;
    if (!meals) {
      const raw = await fetchMeals(rt, { storeCode: store.storeCode, orderType, beType, beCode: store.beCode });
      meals = raw.map((m) => ({ code: mealCode(m), name: mealName(m), price: mealPriceCents(m), raw: m }));
      ctx.meals = meals;
    }

    // 购物车：显式 --cart 优先，否则用 party 方案
    let lines;
    if (flags.cart) {
      lines = toCartLines(meals, flags.cart);
    } else {
      const plan = ctx.partyPlan ?? buildPartyOrder(meals, team.length ? team : ['geo'], {});
      lines = plan.picks.map((p) => ({
        productCode: mealCode(p.meal),
        name: p.name,
        unitPriceCents: mealPriceCents(p.meal) ?? 0,
        quantity: 1,
        priceKnown: mealPriceCents(p.meal) !== null,
      }));
      ctx.partyPlan = plan;
    }
    if (!lines.length) throw new Error('购物车为空：请传 --cart 例如 --cart 1001x1,2001x2');

    for (const l of lines) l.id = l.productCode;

    // 取券
    let rawCoupons = [];
    let unclaimed = [];
    if (rt.demo) {
      rawCoupons = MOCK.storeCoupons;
      unclaimed = MOCK.availableCouponList;
    } else {
      const args = { storeCode: store.storeCode, orderType, beType };
      if (beType !== 1) args.beCode = store.beCode;
      const data = await call(rt.client, 'query-store-coupons', args, { retries: 1 }).catch(() => null);
      rawCoupons = data ? firstArray(data, ['coupons', 'couponList', 'list', 'data']) : [];
      const mine = await call(rt.client, 'query-my-coupons', {}, { retries: 0 }).catch(() => null);
      if (mine) rawCoupons = rawCoupons.concat(firstArray(mine, ['coupons', 'couponList', 'list', 'data']));

      // 麦麦省的未领券：只查不领。
      // 领券（auto-bind-coupons）会改动用户账号资产，属于对外写操作，
      // 必须由用户显式加 --bind-coupons 才执行 —— 不替用户做决定。
      const avail = await call(rt.client, 'available-coupons', {}, { retries: 0 }).catch(() => null);
      unclaimed = avail ? firstArray(avail, ['coupons', 'couponList', 'list', 'data']) : [];

      if (flags['bind-coupons'] && unclaimed.length) {
        try {
          await call(rt.client, 'auto-bind-coupons', {}, { retries: 0 });
          const again = await call(rt.client, 'query-store-coupons', args, { retries: 0 }).catch(() => null);
          if (again) rawCoupons = rawCoupons.concat(firstArray(again, ['coupons', 'couponList', 'list', 'data']));
          unclaimed = [];
        } catch (err) {
          if (flags.verbose) process.stderr.write(`  [领券失败] ${err.message}\n`);
        }
      }
    }

    const coupons = normalizeCoupons(rawCoupons);
    const opts = flags.deep ? { topK: 4, maxNodes: 1200000, perLineLimit: 10 } : { topK: 3 };
    const result = optimizeCart(lines, coupons, opts);

    // 第二段：用官方 calculate-price 真实核价
    let verified = false;
    let bestReal = null;
    let probes = null;

    if (!rt.demo) {
      const priceArgs = (items) => {
        const args = { storeCode: store.storeCode, orderType, beType, items, needTableware: false };
        if (beType !== 1) args.beCode = store.beCode;
        return args;
      };
      const itemsOf = (plan) =>
        plan.lines.map((l) => ({
          productCode: String(l.productCode),
          quantity: l.quantity,
          ...(l.coupon ? couponRef(l.coupon) : {}),
        }));

      // 2a. 候选方案核价
      for (const plan of result.plans.slice(0, 3)) {
        const items = itemsOf(plan);
        // 整单券按平台语义挂在商品行上（券随单走）
        if (plan.orderCoupon && items.length) Object.assign(items[0], couponRef(plan.orderCoupon));
        try {
          const data = await call(rt.client, 'calculate-price', priceArgs(items), { retries: 1 });
          const cents = extractTotalCents(data);
          if (cents !== null) {
            verified = true;
            if (!bestReal || cents < bestReal.finalCents) {
              bestReal = {
                ...plan,
                finalCents: cents,
                savedCents: result.originalCents - cents,
                takeWayList: extractTakeWayList(data),
                raw: data,
              };
            }
          }
        } catch (err) {
          if (flags.verbose) process.stderr.write(`  [核价失败] ${err.message}\n`);
        }
      }

      // 2b. 范围探测：适用品类未知的券，逐个「挂到某一行上」去问官方到底打不打折。
      //     这是本项目对「券元数据不透明」这个现实问题的正面解法 —— 与其猜，不如问。
      const uncertain = result.uncertainCoupons ?? [];
      const maxProbes = Number(flags['max-probes'] ?? 8);
      if (uncertain.length && maxProbes > 0) {
        probes = [];
        let budget = maxProbes;
        outer: for (const c of uncertain) {
          for (const line of lines) {
            if (budget-- <= 0) break outer;
            const items = itemsOf({ lines: lines.map((l) => ({ ...l, coupon: null })) });
            const idx = lines.indexOf(line);
            Object.assign(items[idx], couponRef(c));
            let cents = null;
            try {
              const data = await call(rt.client, 'calculate-price', priceArgs(items), { retries: 0 });
              cents = extractTotalCents(data);
            } catch (err) {
              if (flags.verbose) process.stderr.write(`  [探测失败] ${c.name} → ${line.name}: ${err.message}\n`);
            }
            const savedCents = cents !== null ? result.originalCents - cents : 0;
            probes.push({ couponName: c.name, lineName: line.name, savedCents, line, coupon: c });

            if (savedCents > 0) {
              // 命中了：把它作为一个真实方案塞进候选池
              const planLines = lines.map((l) => ({
                ...l,
                coupon: l === line ? c : null,
                payableCents: l === line ? l.unitPriceCents * l.quantity - savedCents : l.unitPriceCents * l.quantity,
              }));
              result.plans.push({
                sig: `probe:${c.index}:${line.productCode}`,
                lines: planLines,
                orderCoupon: null,
                itemSubtotalCents: result.originalCents - savedCents,
                finalCents: cents,
                savedCents,
                source: 'probe-verified',
              });
            }
          }
        }
        result.plans.sort((a, b) => a.finalCents - b.finalCents || a.savedCents - b.savedCents);
        if (probes.some((p) => p.savedCents > 0)) verified = true;
      }
    }

    // 汇总：拿到「真实金额」的方案优先展示；本地估算只在一个都没核成时兜底。
    // 混排本地估算与官方核价会让用户分不清哪个数字能信，所以两者不混。
    if (bestReal) {
      result.plans = [bestReal, ...result.plans.filter((p) => p.sig !== bestReal.sig)];
    }
    result.plans = result.plans.map((p) => ({
      ...p,
      verified: p.source === 'baseline' || p.source === 'probe-verified' || p === bestReal,
    }));
    const anyVerified = result.plans.some((p) => p.verified && p.savedCents > 0);
    const payload = anyVerified ? { ...result, plans: result.plans.filter((p) => p.verified) } : result;

    ctx.optimized = payload;
    ctx.coupons = coupons;

    if (out.json) {
      return out.raw({
        store,
        coupons: coupons.map((cn) => ({
          name: cn.name,
          couponId: cn.couponId,
          couponCode: cn.couponCode,
          scope: cn.scope,
          uncertain: cn.uncertain,
        })),
        originalCents: payload.originalCents,
        plans: payload.plans.map((p) => ({
          finalCents: p.finalCents,
          savedCents: p.savedCents,
          verified: p.verified,
          source: p.source,
          lines: p.lines.map((l) => ({ name: l.name, productCode: l.productCode, coupon: l.coupon?.name ?? null })),
          orderCoupon: p.orderCoupon?.name ?? null,
        })),
        probes: probes?.map((p) => ({
          coupon: p.couponName,
          line: p.lineName,
          savedCents: p.savedCents,
          applicable: p.savedCents > 0,
        })) ?? null,
        unclaimedCouponCount: unclaimed.length,
        boundCoupons: Boolean(flags['bind-coupons']),
        verified,
        demo: rt.demo,
      });
    }

    return out.text(
      R.renderArtifact(payload, { storeName: store?.storeName, coupons, verified, probes, unclaimed }) +
        R.footer(
          verified
            ? '最终金额由麦当劳 MCP calculate-price 核价'
            : rt.demo
              ? MOCK.MOCK_NOTE
              : '未取得核价结果，金额为本地保守估算（未向官方确认可用性）',
        ),
    );
  });
}

async function cmdWish(rt, flags, out, ctx) {
  return await withClient(rt, async () => {
    const info = rt.demo ? MOCK.lotteryInfo : await call(rt.client, 'query-lottery-info', {});
    let result = null;
    let prizes = null;

    if (flags.draw) {
      const decision = info?.drawDecision ?? {};
      if (decision.resourceEligible === false) {
        result = { status: { code: 'NOT_ELIGIBLE', message: '当前资源不足，无法祈愿' }, win: false, prizes: [] };
      } else if (rt.demo) {
        result = MOCK.lotteryResult;
      } else {
        // 严格按 MCP 约束：先展示 nextConsumption，再执行；不试抽、不连抽
        try {
          result = await call(rt.client, 'draw-lottery', {}, { retries: 0 });
        } catch (err) {
          result = { status: { code: 'ERROR', message: err.message }, win: false, prizes: [] };
        }
      }
    }

    try {
      prizes = rt.demo ? MOCK.myPrizes : await call(rt.client, 'query-my-prizes', { pageNum: '1', pageSize: '10' }, { retries: 0 });
    } catch {
      prizes = null;
    }

    if (out.json) return out.raw({ info, result, prizes, demo: rt.demo });
    return out.text(
      R.renderWish(info, result, prizes) +
        R.footer(rt.demo ? MOCK.MOCK_NOTE : '数据来源：麦当劳 MCP query-lottery-info / draw-lottery / query-my-prizes'),
    );
  });
}

async function cmdPrizes(rt, flags, out) {
  return await withClient(rt, async () => {
    const prizes = rt.demo ? MOCK.myPrizes : await call(rt.client, 'query-my-prizes', { pageNum: '1', pageSize: '20' });
    if (out.json) return out.raw({ prizes, demo: rt.demo });
    return out.text(R.renderWish(null, null, prizes) + R.footer(rt.demo ? MOCK.MOCK_NOTE : '数据来源：query-my-prizes'));
  });
}

async function cmdCalendar(rt, flags, out) {
  return await withClient(rt, async () => {
    const raw = rt.demo
      ? { data: MOCK.campaignCalendar }
      : await call(rt.client, 'campaign-calendar', flags.date ? { specifiedDate: flags.date } : {});
    const items = firstArray(raw, ['activities', 'calendar', 'list', 'days', 'data']);
    if (out.json) return out.raw({ items, demo: rt.demo });
    const lines = [R.section('', '活动秘境', '当月营销活动')];
    if (!items.length) {
      lines.push('', '  ' + R.footer('本月暂无活动数据。').trim());
    }
    for (const it of items) {
      const date = pick(it, ['date', 'day', 'activityDate'], '-');
      const title = pick(it, ['title', 'name', 'activityName'], '(未命名活动)');
      const status = pick(it, ['status', 'statusText'], '');
      const desc = pick(it, ['desc', 'description', 'subTitle'], '');
      lines.push('', `  ◆ ${R.pad(String(date), 12)} ${title}  ${status ? `【${status}】` : ''}`);
      if (desc) lines.push(`    ${' '.repeat(0)}${desc}`);
    }
    lines.push('', R.footer(rt.demo ? MOCK.MOCK_NOTE : '数据来源：麦当劳 MCP campaign-calendar'));
    return out.text(lines.join('\n'));
  });
}

async function cmdCommission(rt, flags, out, ctx) {
  return await withClient(rt, async () => {
    const store = await resolveStore(rt, flags, ctx);
    const beType = Number(flags['be-type'] ?? 1);
    const orderType = beType === 1 || beType === 5 ? 1 : 2;

    if (!ctx.optimized) {
      // CLI 每次调用都是独立进程，ctx 不会跨命令保留。
      // 单独跑 commission 时，先把券优化链路静默跑一遍，拿到价格方案再下单。
      const silent = { json: false, text: (s) => s, raw: (o) => JSON.stringify(o) };
      await cmdArtifact(rt, flags, silent, ctx);
    }
    const opt = ctx.optimized;
    if (!opt) throw new Error('还没有价格方案，请先运行 artifact 子命令');

    const best = opt.plans[0];
    const items = best.lines.map((l) => ({
      productCode: String(l.productCode),
      quantity: l.quantity,
      name: l.name,
      ...(l.coupon ? couponRef(l.coupon) : {}),
    }));

    const preview = {
      storeName: store?.storeName,
      totalCents: best.finalCents,
      items,
      takeWayList: best.takeWayList ?? [{ code: 'TW01', name: '到店取餐' }],
      status: flags.confirm ? '待支付' : '预览（未提交）',
    };

    if (!flags.confirm) {
      if (out.json) return out.raw({ preview, demo: rt.demo, submitted: false });
      return out.text(
        R.renderCommission(preview, { storeName: store?.storeName }) +
          R.footer('未加 --confirm，本次只做预览，没有向麦当劳提交任何数据。'),
      );
    }

    if (rt.demo) {
      const order = MOCK.mockCommissionPreview(items, best.finalCents);
      order.status = '待支付';
      if (out.json) return out.raw({ order, demo: true, submitted: true });
      return out.text(R.renderCommission(order, { storeName: store?.storeName }) + R.footer(MOCK.MOCK_NOTE));
    }

    const args = {
      storeCode: store.storeCode,
      orderType,
      beType,
      items,
      takeWayCode: preview.takeWayList[0]?.code ?? 'TW01',
      needTableware: false,
    };
    if (beType !== 1) args.beCode = store.beCode;
    const order = await call(rt.client, 'create-order', args, { retries: 0 });
    const flat = {
      orderId: pick(order, ['orderId', 'orderNo', 'id'], '-'),
      status: pick(order, ['status', 'statusText', 'orderStatus'], '已提交'),
      totalCents: extractTotalCents(order) ?? best.finalCents,
      payUrl: pick(order, ['payUrl', 'paymentUrl', 'url']),
      takeWayList: preview.takeWayList,
      items,
    };
    if (out.json) return out.raw({ order: flat, raw: order, demo: false, submitted: true });
    return out.text(R.renderCommission(flat, { storeName: store?.storeName }) + R.footer('数据来源：麦当劳 MCP create-order'));
  });
}

async function cmdDemo(flags, out) {
  const localFlags = { ...flags, demo: true, team: flags.team ?? '火,冰' };
  const ctx = {};
  const rt = { demo: true, client: null };
  const buf = [];
  const collect = (s) => buf.push(s);

  buf.push(R.banner({ demo: true, scene: '全链路演示' }));
  buf.push(R.mockWarning(MOCK.MOCK_NOTE));
  buf.push(R.mockWarning('演示中的店铺 / 餐品 / 券 / 奖品均为虚构示例，接入 Token 后全部来自麦当劳 MCP。'));

  const o1 = { json: false, raw: (x) => '', text: (s) => (collect(s), s) };
  await cmdAnchor(rt, localFlags, o1, ctx);
  await cmdMenu(rt, localFlags, o1, ctx);
  await cmdParty(rt, localFlags, o1, ctx);
  await cmdArtifact(rt, localFlags, o1, ctx);
  await cmdWish(rt, { ...localFlags, draw: true }, o1, ctx);
  await cmdCommission(rt, localFlags, o1, ctx);

  buf.push(R.footer('演示结束。接上真实 Token 后：export MCD_MCP_TOKEN=<Token> 再去掉 --demo 即可。'));

  if (out.json) {
    return out.raw({ note: MOCK.MOCK_NOTE, text: buf.join('\n') });
  }
  return out.text(buf.join('\n'));
}

// ------------------------------------------------------------------ 入口

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0] ?? (flags.help ? 'help' : 'help');

  const asJson = Boolean(flags.json);
  const collect = [];
  const out = {
    json: asJson,
    text: (s) => {
      if (asJson) return s;
      process.stdout.write(s + '\n');
      return s;
    },
    raw: (obj) => {
      const s = JSON.stringify(obj, null, 2);
      process.stdout.write(s + '\n');
      return s;
    },
  };

  if (cmd === 'help' || flags.help) {
    process.stdout.write(HELP + '\n');
    return 0;
  }

  const KNOWN = ['doctor', 'anchor', 'menu', 'party', 'artifact', 'wish', 'prizes', 'calendar', 'commission', 'demo'];
  if (!KNOWN.includes(cmd)) {
    process.stderr.write(`未知子命令：${cmd}\n${HELP}\n`);
    return 2;
  }

  let rt;
  try {
    rt = cmd === 'demo' ? { demo: true, client: null } : createRuntime({ demo: Boolean(flags.demo) });
  } catch (err) {
    // 配置类错误（缺 Token / URL 非法）也要给人话化输出，别甩栈
    if (asJson) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message, stage: err.stage ?? 'config' }, null, 2) + '\n');
    } else {
      process.stderr.write('\n' + R.c('#ff6b4a', '✘ 无法启动：') + err.message + '\n\n');
    }
    return 1;
  }
  const ctx = {};

  const commands = {
    doctor: (f, o) => cmdDoctor(f, o),
    anchor: (f, o) => cmdAnchor(rt, f, o, ctx),
    menu: (f, o) => cmdMenu(rt, f, o, ctx),
    party: (f, o) => cmdParty(rt, f, o, ctx),
    artifact: (f, o) => cmdArtifact(rt, f, o, ctx),
    wish: (f, o) => cmdWish(rt, f, o, ctx),
    prizes: (f, o) => cmdPrizes(rt, f, o),
    calendar: (f, o) => cmdCalendar(rt, f, o),
    commission: (f, o) => cmdCommission(rt, f, o, ctx),
    demo: (f, o) => cmdDemo(f, o),
  };

  const fn = commands[cmd];

  // --json 时不打 banner，避免污染机器可读输出
  if (!asJson) {
    if (rt.demo && cmd !== 'doctor' && cmd !== 'demo') {
      process.stdout.write(R.banner({ demo: true, scene: cmd }) + '\n');
      process.stdout.write(R.mockWarning(MOCK.MOCK_NOTE) + '\n');
    } else if (!rt.demo && cmd !== 'doctor') {
      process.stdout.write(R.banner({ demo: false, scene: cmd }) + '\n');
    }
  }

  try {
    await fn(flags, out);
    return 0;
  } catch (err) {
    if (asJson) {
      process.stdout.write(JSON.stringify({ ok: false, error: err.message, stage: err.stage ?? null }, null, 2) + '\n');
    } else {
      process.stderr.write('\n' + R.c('#ff6b4a', '✘ 执行失败：') + err.message + '\n');
      if (err.stage) process.stderr.write(R.faint(`  阶段：${err.stage}`) + '\n');
      process.stderr.write(R.faint('  提示：不带 Token 时可加 --demo 先看完整效果。') + '\n\n');
    }
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`未捕获错误：${err?.stack ?? err}\n`);
    process.exit(1);
  });
