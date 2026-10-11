/**
 * 提瓦特风终端渲染层
 *  - 真彩色 ANSI，元素色与 ELEMENTS[].hex 对应
 *  - 自己算中日韩字符宽度，保证框线对得齐
 *  - 同时导出 renderPlain()，供 --json / 无颜色环境使用
 */

import { ELEMENTS, ELEMENT_ORDER, elementStyle } from './elemental.mjs';
import { describeCoupon, fmtYuan, centsToMora } from './artifact.mjs';

// 只在真终端里上色；管道 / 重定向默认输出纯文本，方便 grep 与贴 issue。
// 想让管道也带色：FORCE_COLOR=1；想去掉颜色（即使 TTY）：NO_COLOR=1
const USE_COLOR =
  process.env.NO_COLOR === undefined &&
  (process.stdout.isTTY === true || process.env.FORCE_COLOR === '1');

export function hexToAnsi(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';
const GREY = '\x1b[38;2;150;160;175m';
const FAINT = '\x1b[38;2;105;115;130m';
const GOLD = '\x1b[38;2;224;169;59m';
const GREEN = '\x1b[38;2;95;216;164m';

export const c = (hex, s) => (USE_COLOR ? hexToAnsi(hex) + s + RESET : s);
export const bold = (s) => (USE_COLOR ? BOLD + s + RESET : s);
export const dim = (s) => (USE_COLOR ? DIM + s + RESET : s);
export const grey = (s) => (USE_COLOR ? GREY + s + RESET : s);
export const faint = (s) => (USE_COLOR ? FAINT + s + RESET : s);
export const gold = (s) => (USE_COLOR ? GOLD + s + RESET : s);
export const green = (s) => (USE_COLOR ? GREEN + s + RESET : s);

export const el = (key, s) => c(elementStyle(key).hex, s);

/** 显示宽度：CJK / 全角标点按 2 计 */
export function dw(str) {
  let n = 0;
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff);
    n += wide ? 2 : 1;
  }
  return n;
}

export function pad(str, width, align = 'left') {
  const gap = Math.max(0, width - dw(str));
  if (align === 'right') return ' '.repeat(gap) + str;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + str + ' '.repeat(gap - left);
  }
  return str + ' '.repeat(gap);
}

export function truncate(str, width) {
  let out = '';
  let n = 0;
  for (const ch of String(str)) {
    const w = dw(ch);
    if (n + w > width - 1) return out + '…';
    out += ch;
    n += w;
  }
  return out;
}

const LINE = '─';
const bar = (n) => LINE.repeat(n);

export function rule(width = 72) {
  return faint(bar(width));
}

export function section(index, title, subtitle = '') {
  const head = USE_COLOR
    ? `${gold('◆')} ${bold(title)}${subtitle ? '  ' + faint(subtitle) : ''}`
    : `* ${title}${subtitle ? '  ' + subtitle : ''}`;
  return `\n${head}\n${rule(72)}`;
}

// ------------------------------------------------------------------ 头部

export function banner({ demo = false, store = null, scene = '' } = {}) {
  const title = '麦门祈愿 · 提瓦特冒险家点餐台';
  const sub = 'TEYVAT MCD ORACLE  ·  powered by 麦当劳 MCP';
  const out = [];
  out.push('');
  out.push('  ' + c('#ff6b4a', '⌒') + c('#e0a93b', '⌒') + c('#5fd8a4', '⌒') + c('#4aa8ff', '⌒'));
  out.push('  ' + bold(c('#e0a93b', title)));
  out.push('  ' + faint(sub));
  const ctx = [];
  if (demo) ctx.push(c('#ff6b4a', '⚠ 离线演示模式（虚构数据，非官方实时信息）'));
  if (store) ctx.push(faint(`当前锚点：${store}`));
  if (scene) ctx.push(faint(`委托类型：${scene}`));
  if (ctx.length) {
    out.push('');
    ctx.forEach((l) => out.push('  ' + l));
  }
  out.push('');
  return out.join('\n');
}

export function mockWarning(text) {
  return '  ' + c('#ff6b4a', '⚠ ') + grey(text);
}

// ------------------------------------------------------------------ 各场景

export function renderAnchors(stores, team = []) {
  const out = [section('', '壹 · 传送锚点', '附近可用门店')];
  if (!stores.length) {
    out.push(grey('  未找到门店。换个关键词或城市再试。'));
    return out.join('\n');
  }
  stores.forEach((s, i) => {
    const tag = s.beType === 5 ? c('#b07cff', '[得来速]') : c('#5fd8a4', '[到店自取]');
    out.push('');
    out.push(`  ${gold(String(i + 1) + '.')} ${bold(s.storeName ?? '(未命名门店)')} ${tag}`);
    out.push(`     ${grey('storeCode')} ${s.storeCode ?? '-'}${s.beCode ? `   ${grey('beCode')} ${s.beCode}` : ''}`);
    if (s.address) out.push(`     ${faint(s.address)}`);
    const meta = [];
    if (s.distance) meta.push(`距离 ${s.distance}`);
    if (s.reservation) meta.push('支持预约');
    if (meta.length) out.push(`     ${faint(meta.join(' · '))}`);
    if (s.reservation && Array.isArray(s.reservationTimeOptions) && s.reservationTimeOptions.length) {
      out.push(`     ${faint('预约时段：' + s.reservationTimeOptions.join(' / '))}`);
    }
  });
  if (team.length) {
    out.push('');
    out.push('  ' + faint('提示：选定锚点后即可开启元素共鸣点单。'));
  }
  return out.join('\n');
}

export function renderMenu(meals, team = []) {
  const out = [section('', '贰 · 料理图鉴', `共 ${meals.length} 项`)];

  // 按第一个元素分组标注
  const primary = team[0] ?? null;
  const rows = meals.map((m) => {
    const elKey = bestElement(m.name);
    return { name: m.name, code: String(m.code), priceCents: m.price, elKey };
  });

  const wName = Math.min(30, Math.max(...rows.map((r) => dw(r.name)), 8));
  const wCode = Math.max(...rows.map((r) => r.code.length), 6);
  out.push('');
  out.push(
    '  ' + faint(pad('餐品', wName) + '  ' + pad('code', wCode) + '  ' + pad('价格', 10, 'right') + '   元素'),
  );
  for (const r of rows) {
    const tag = r.elKey ? el(r.elKey, `[${elementStyle(r.elKey).zh}]`) : faint('[·]');
    out.push(
      '  ' +
        pad(r.name, wName) +
        '  ' +
        faint(pad(r.code, wCode)) +
        '  ' +
        pad(fmtYuan(r.priceCents), 10, 'right') +
        '   ' +
        tag,
    );
  }
  out.push('');
  out.push('  ' + faint('元素标签由菜品名称关键词推导，仅用于搭配建议。实际餐品与价格以门店为准。'));
  if (primary) {
    out.push('  ' + faint(`当前队伍主元素：${elementStyle(primary).full}`));
  }
  return out.join('\n');
}

/** 反查：菜品名称最匹配哪个元素 */
function bestElement(name) {
  let best = null;
  let bestScore = 0;
  for (const key of ELEMENT_ORDER) {
    const kws = ELEMENTS[key].keywords;
    let s = 0;
    kws.forEach((kw, i) => {
      if (String(name).includes(kw)) s += Math.max(1, 10 - i);
    });
    if (s > bestScore) {
      bestScore = s;
      best = key;
    }
  }
  return best;
}

export function renderPartyPlan(plan, { storeName = null } = {}) {
  const out = [];
  const { team, reaction } = plan;
  out.push(section('', '叁 · 元素共鸣点单', '由队伍元素推导的搭配方案'));

  if (team.length) {
    out.push('');
    out.push('  ' + bold('队伍元素 ') + team.map((k) => el(k, `◈ ${elementStyle(k).zh}`)).join('  '));
  }
  if (reaction) {
    out.push('  ' + bold('元素反应 ') + gold(`「${reaction.name}」`) + '  ' + grey(reaction.note));
  }

  out.push('');
  out.push('  ' + faint(pad('槽位', 8) + pad('推荐餐品', 26) + pad('元素', 8) + pad('价格', 10, 'right')));
  for (const p of plan.picks) {
    const st = elementStyle(p.element);
    const slotName = p.filler ? '补位' : st.slotName;
    out.push(
      '  ' +
        faint(pad(slotName, 8)) +
        pad(p.name, 26) +
        el(p.element, pad(st.zh, 8)) +
        pad(fmtYuan(p.meal?.price ?? 0), 10, 'right'),
    );
  }
  out.push('  ' + faint(bar(64)));
  out.push(
    '  ' +
      bold(pad('原价合计', 42)) +
      pad(fmtYuan(plan.originalCents), 10, 'right') +
      '  ' +
      faint(`≈ ${centsToMora(plan.originalCents)} 摩拉`),
  );
  if (storeName) {
    out.push('');
    out.push('  ' + faint(`锚点：${storeName}`));
  }
  out.push('');
  out.push('  ' + grey('下一步：运行 artifact 子命令，用你的圣遗物（优惠券）压低这份账单。'));
  return out.join('\n');
}

export function renderArtifact(result, { storeName = null, coupons = [], verified = false, probes = null, unclaimed = [] } = {}) {
  const out = [];
  out.push(section('', '肆 · 圣遗物强化', '优惠券组合最优解'));
  const { originalCents, plans, stats } = result;

  out.push('');
  out.push(
    '  ' + faint('原始账单 ') + bold(fmtYuan(originalCents)) + faint(`  （≈ ${centsToMora(originalCents)} 摩拉）`),
  );
  if (coupons.length) {
    out.push('  ' + faint(`参战圣遗物 ${coupons.length} 件：`));
    coupons.forEach((cp) => {
      const tag = cp.uncertain ? faint(' → 需官方核价探测') : '';
      out.push(
        '    ' +
          el(cp.uncertain ? 'electro' : 'cryo', '◇') +
          ' ' +
          pad(truncate(cp.name, 30), 32) +
          faint(describeCoupon(cp)) +
          tag,
      );
    });
  }

  const shown = plans.filter((p) => p.savedCents > 0).slice(0, 3);
  if (!shown.length) {
    out.push('');
    out.push('  ' + grey('没有找到能进一步压价的组合 —— 这套配队已经是摩拉最优了。'));
  }

  if (shown.length) {
    out.push('');
    out.push(
      '  ' +
        bold('候选方案') +
        faint(verified ? '（金额已由 calculate-price 真实核价）' : '（本地估算 · 优惠上限，未向官方核价）'),
    );
    if (!verified) {
      out.push('  ' + faint('券的适用范围在接口里常常只有一个名字，本地只做保守估算；够不够用最终由 calculate-price 说了算。'));
    }
    out.push('');
    shown.forEach((p, i) => {
      const medal = i === 0 ? gold('★ 最优') : faint(`  第${i + 1}优`);
      out.push(
        `  ${medal}  ${bold(fmtYuan(p.finalCents))}   ${green('省 ' + fmtYuan(p.savedCents))}` +
          `   ${faint(`≈ ${centsToMora(p.savedCents)} 摩拉`)}`,
      );
      for (const l of p.lines) {
        if (!l.coupon) continue;
        out.push(
          '        ' + el('cryo', '◇') + ' ' + pad(truncate(l.name, 22), 24) + faint('用券：' + l.coupon.name),
        );
      }
      if (p.orderCoupon) {
        out.push('        ' + el('cryo', '◇') + ' ' + pad('整单', 24) + faint('用券：' + p.orderCoupon.name));
      }
      out.push('');
    });
  }

  if (Array.isArray(probes) && probes.length) {
    const gains = probes.filter((p) => p.savedCents > 0);
    out.push('  ' + bold('范围探测') + faint('（拿 calculate-price 当探针，问出「这张券到底能打什么」）'));
    for (const p of probes) {
      if (p.savedCents > 0) {
        out.push(
          '    ' +
            green('✔') +
            ' ' +
            pad(truncate(p.couponName, 22), 24) +
            faint(`可作用于「${p.lineName}」`) +
            '  ' +
            green('省 ' + fmtYuan(p.savedCents)),
        );
      } else {
        out.push(
          '    ' + faint('✘') + ' ' + pad(truncate(p.couponName, 22), 24) + faint(`在「${p.lineName}」上不生效`),
        );
      }
    }
    if (gains.length) {
      out.push('');
      out.push('  ' + faint('已把探测到的可用组合纳入上面的候选方案重新排序。'));
    }
    out.push('');
  }

  if (Array.isArray(unclaimed) && unclaimed.length) {
    out.push(
      '  ' +
        gold('✦ ') +
        bold(`麦麦省还有 ${unclaimed.length} 张券没领：`) +
        faint(unclaimed.map((u) => u.name ?? u.couponName ?? '未命名券').join('、')),
    );
    out.push('    ' + faint('领券会改动你的账号资产，所以默认不自动领。确认要领就加 --bind-coupons。'));
    out.push('');
  }

  if (stats?.truncated) {
    out.push('  ' + faint('搜索空间已触发剪枝（组合过多），存在更优解的可能；可加 --deep 扩大搜索。'));
    out.push('');
  }
  return out.join('\n');
}

export function renderWish(info, result = null, prizes = null) {
  const out = [section('', '伍 · 祈愿台', '积分祈愿（抽奖）')];

  if (info) {
    out.push('');
    out.push(`  ${bold(info.activityName ?? '祈愿活动')}  ${info.activityStatusText ? gold(`[${info.activityStatusText}]`) : ''}`);
    if (info.beginTime && info.endTime) {
      out.push('  ' + faint(`活动期 ${info.beginTime} ~ ${info.endTime}`));
    }
    const d = info.drawDecision ?? {};
    out.push('  ' + faint(`规则 ${info.drawTypeText ?? '-'}   单次 ${info.drawPoint ?? '-'} 积分`));
    if (info.availableTimes !== undefined && info.availableTimes !== null) {
      out.push('  ' + faint(`剩余祈愿次数 ${info.availableTimes}`));
    }
    if (info.availablePoint !== undefined && info.availablePoint !== null) {
      out.push('  ' + faint(`可用摩拉积分 ${info.availablePoint}`));
    }
    if (d.nextConsumption) {
      const txt = d.nextConsumption.text ?? `${d.nextConsumption.type} × ${d.nextConsumption.amount}`;
      out.push('  ' + bold('本次将消耗：') + gold(txt));
    }
    if (d.fallbackConsumption) {
      const txt = d.fallbackConsumption.text ?? `${d.fallbackConsumption.type} × ${d.fallbackConsumption.amount}`;
      out.push('  ' + faint(`次数用完后：${txt}`));
    }
    if (Array.isArray(info.prizes) && info.prizes.length) {
      out.push('');
      out.push('  ' + bold('本期奖池'));
      info.prizes.forEach((p, i) => {
        out.push('    ' + faint(String(i + 1) + '.') + ' ' + (p.name ?? '-') + '  ' + faint(p.typeText ?? ''));
      });
    }
    out.push('');
    out.push('  ' + grey('祈愿需你明确确认后才执行；本项目不会自动抽、不会连抽。'));
  }

  if (result) {
    out.push('');
    const ok = result.status?.code === undefined || /success/i.test(String(result.status?.code));
    out.push('  ' + (result.win ? gold('✦ 祈愿命中！') : grey('○ 本次未命中，下次一定。')));
    if (!ok && result.status?.message) {
      out.push('  ' + c('#ff6b4a', `状态：${result.status.message}`));
    }
    (result.prizes ?? []).forEach((p) => {
      out.push('    ' + gold('✦ ') + bold(p.name ?? '-') + '  ' + faint(p.typeText ?? '') + '  ' + faint(p.validDateInfo ?? ''));
    });
  }

  if (prizes && Array.isArray(prizes.prizes) && prizes.prizes.length) {
    out.push('');
    out.push('  ' + bold('祈愿记录'));
    prizes.prizes.forEach((p) => {
      const st = p.statusText ?? p.status ?? '';
      const color = /可用|已领取/.test(st) ? green(st) : faint(st);
      out.push('    ' + pad(truncate(p.name ?? '-', 24), 26) + color + '  ' + faint(p.recordTime ?? ''));
    });
  }
  return out.join('\n');
}

export function renderCommission(order, { storeName = null } = {}) {
  const out = [section('', '陆 · 冒险家委托', '门店取餐订单')];
  out.push('');
  if (order.orderId) out.push('  ' + faint('委托编号 ') + bold(order.orderId));
  if (storeName) out.push('  ' + faint('交付锚点 ') + storeName);
  if (order.status) out.push('  ' + faint('状态     ') + gold(order.status));
  if (order.totalCents !== undefined) {
    out.push('  ' + faint('应付     ') + bold(fmtYuan(order.totalCents)) + faint(`  ≈ ${centsToMora(order.totalCents)} 摩拉`));
  }
  if (Array.isArray(order.takeWayList) && order.takeWayList.length) {
    out.push('  ' + faint('取餐方式 ') + order.takeWayList.map((t) => t.name ?? t.code).join(' / '));
  }
  if (Array.isArray(order.items) && order.items.length) {
    out.push('');
    order.items.forEach((it) => {
      out.push('    ' + faint('·') + ' ' + (it.name ?? it.productCode) + ' ×' + (it.quantity ?? 1));
    });
  }
  out.push('');
  out.push('  ' + c('#ff6b4a', '⚠ 本步骤属于「线上写操作」。本项目默认只做预览，真实下单须由你在对话中明确确认。'));
  if (order.payUrl) out.push('  ' + faint('支付链接（演示）' + order.payUrl));
  return out.join('\n');
}

export function renderDoctor(report) {
  const out = [section('', '诊断 · 连接器自检')];
  out.push('');
  for (const r of report.checks) {
    const mark = r.ok ? green('✔') : c('#ff6b4a', '✘');
    out.push(`  ${mark} ${pad(r.name, 26)} ${r.ok ? faint(r.detail ?? '') : c('#ff6b4a', r.detail ?? '')}`);
  }
  const failed = report.checks.filter((r) => !r.ok).length;
  out.push('');
  out.push(
    '  ' +
      (failed
        ? c('#ff6b4a', `${failed} 项未通过 —— 修好后即可用真实数据跑通全流程。`)
        : green('全部通过，可以直连麦当劳 MCP 了。')),
  );
  return out.join('\n');
}

export function footer(text) {
  return '\n' + faint(text) + '\n';
}
