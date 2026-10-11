/**
 * 元素共鸣点单引擎
 *
 * 把「队伍元素构成」映射成「麦当劳点单结构」，并给出元素反应叙事。
 *
 * 设计原则：
 *  - 映射是**基于菜品名称关键词的**，不依赖任何写死的商品编码，
 *    所以门店菜单变了、商品下架了，映射依然有效（只会匹配不到，不会报错）。
 *  - 七个元素对应七种口味/品类，互为补充，凑齐一套就是完整的一餐。
 */

export const ELEMENTS = {
  pyro: {
    key: 'pyro',
    zh: '火',
    full: '火元素',
    hex: '#ff6b4a',
    taste: '热辣',
    motto: '烈焰燎原 —— 辣度即攻击力',
    // 命中任一关键词即视为该元素菜品（关键词按优先级排序）
    keywords: ['麦辣', '香辣', '辣味', '辣', '鸡腿堡', '鸡翅', '鸡块', '板烧', '烤', '鸡'],
    slot: 'main',
    slotName: '主菜',
  },
  hydro: {
    key: 'hydro',
    zh: '水',
    full: '水元素',
    hex: '#4aa8ff',
    taste: '解渴',
    motto: '静水流深 —— 一口回满血条',
    keywords: ['可乐', '雪碧', '饮品', '汽水', '果汁', '橙汁', '红茶', '柠檬', '矿泉水', '茶', '饮'],
    slot: 'drink',
    slotName: '饮品',
  },
  anemo: {
    key: 'anemo',
    zh: '风',
    full: '风元素',
    hex: '#5fd8a4',
    taste: '轻盈',
    motto: '风起于青萍之末 —— 轻食不压身',
    keywords: ['沙拉', '鲜蔬', '蔬菜', '卷', '轻', '鸡排', '鸡胸', '玉米杯'],
    slot: 'light',
    slotName: '轻食',
  },
  electro: {
    key: 'electro',
    zh: '雷',
    full: '雷元素',
    hex: '#b07cff',
    taste: '提神',
    motto: '雷光乍现 —— 咖啡因即是元素充能',
    keywords: ['咖啡', '拿铁', '美式', '卡布', '摩卡', '能量', '提神'],
    slot: 'boost',
    slotName: '充能',
  },
  dendro: {
    key: 'dendro',
    zh: '草',
    full: '草元素',
    hex: '#8cc63f',
    taste: '清爽',
    motto: '生生不息 —— 多吃一口青菜',
    keywords: ['沙拉', '蔬', '玉米', '苹果', '鲜', '青'],
    slot: 'light',
    slotName: '轻食',
  },
  cryo: {
    key: 'cryo',
    zh: '冰',
    full: '冰元素',
    hex: '#7fe3f0',
    taste: '甜冰',
    motto: '寒霜凝结 —— 甜品是最后的仪式感',
    keywords: ['冰淇淋', '新地', '麦旋风', '圣代', '甜筒', '派', '冰', '甜'],
    slot: 'dessert',
    slotName: '甜品',
  },
  geo: {
    key: 'geo',
    zh: '岩',
    full: '岩元素',
    hex: '#e0a93b',
    taste: '扎实',
    motto: '磐岩不动 —— 主食才是输出核心',
    keywords: ['巨无霸', '安格斯', '牛肉', '双吉', '吉士', '堡', '薯条', '薯'],
    slot: 'main',
    slotName: '主菜',
  },
};

export const ELEMENT_ORDER = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'];

/** 中文别名 → 元素 key（支持「火/火元素/火系/pyro」等写法） */
const ALIASES = new Map();
for (const [key, el] of Object.entries(ELEMENTS)) {
  for (const alias of [key, el.zh, el.full, `${el.zh}系`, `${el.zh}元素`]) {
    ALIASES.set(alias.toLowerCase(), key);
  }
}

export function parseElement(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  return ALIASES.get(s) ?? null;
}

export function parseTeam(input) {
  if (!input) return [];
  const parts = Array.isArray(input)
    ? input
    : String(input)
        .split(/[\s,+、/|]+/)
        .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const k = parseElement(p);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** 元素反应表：双元素 → 反应名 + 搭配策略 */
const REACTIONS = {
  'pyro+hydro': { name: '蒸发', note: '辣味主菜 + 冰饮，伤害翻倍', bonus: 1.0 },
  'pyro+electro': { name: '超载', note: '辣味主菜 + 咖啡，午后的炸裂组合', bonus: 1.0 },
  'pyro+cryo': { name: '融化', note: '辣味主菜 + 冰甜品，冷热交替', bonus: 1.0 },
  'hydro+cryo': { name: '冻结', note: '冰饮 + 冰甜品，全冰阵型（注意胃）', bonus: 1.0 },
  'electro+cryo': { name: '超导', note: '咖啡 + 冰甜品，超标充能', bonus: 1.0 },
  'dendro+hydro': { name: '绽放', note: '沙拉 + 冰饮，健康向配队', bonus: 1.0 },
  'anemo+pyro': { name: '扩散', note: '轻食 + 辣味主菜，负担小、伤害高', bonus: 1.0 },
  'geo+geo': { name: '结晶', note: '双主食，岩队专属的碳水阵型', bonus: 1.0 },
};

export function reactionOf(team) {
  if (team.length < 2) {
    if (!team.length) return null;
    const el = ELEMENTS[team[0]];
    return { name: '单元素共鸣', note: `${el.full}纯粹输出，${el.motto}`, bonus: 1.0 };
  }
  const a = team[0];
  const b = team[1];
  const direct = REACTIONS[`${a}+${b}`] ?? REACTIONS[`${b}+${a}`];
  if (direct) return direct;
  const withAnemo = a === 'anemo' || b === 'anemo' ? REACTIONS['anemo+pyro'] : null;
  if (withAnemo) return { ...withAnemo, name: '扩散' };
  return {
    name: '元素共鸣',
    note: `${ELEMENTS[a].full} × ${ELEMENTS[b].full} —— 非主流配队，但吃得开心最重要`,
    bonus: 1.0,
  };
}

// ------------------------------------------------------------------ 菜品匹配

const NAME_KEYS = ['name', 'productName', 'mealName', 'title', 'cnName', 'displayName'];
const CODE_KEYS = ['code', 'productCode', 'mealCode', 'id', 'spuCode', 'skuCode'];
const PRICE_KEYS = ['price', 'salePrice', 'currentPrice', 'amount', 'unitPrice', 'origPrice'];

export function mealName(meal) {
  const v = NAME_KEYS.map((k) => meal?.[k]).find((x) => typeof x === 'string' && x.trim());
  return v ? v.trim() : '(未命名餐品)';
}

export function mealCode(meal) {
  const v = CODE_KEYS.map((k) => meal?.[k]).find((x) => x !== undefined && x !== null && x !== '');
  return v === undefined ? null : String(v);
}

export function mealPriceCents(meal) {
  const raw = PRICE_KEYS.map((k) => meal?.[k]).find((x) => x !== undefined && x !== null && x !== '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 计算某菜品对某元素的契合分（关键词命中 + 名称位置加权） */
export function scoreForElement(name, elementKey) {
  const el = ELEMENTS[elementKey];
  if (!el || !name) return 0;
  const n = String(name);
  let score = 0;
  el.keywords.forEach((kw, i) => {
    if (n.includes(kw)) score += Math.max(1, 10 - i);
  });
  return score;
}

/**
 * 从菜单里为某元素挑出最契合的 N 个候选（已按契合度 + 价格排序）
 */
export function candidatesForElement(meals, elementKey, { limit = 5 } = {}) {
  return meals
    .map((m) => ({ meal: m, name: mealName(m), score: scoreForElement(mealName(m), elementKey) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (mealPriceCents(a.meal) ?? 0) - (mealPriceCents(b.meal) ?? 0))
    .slice(0, limit);
}

/**
 * 组队 → 点单方案
 * 规则：主菜必须 1 个（取队伍中第一个「main」槽位元素），其余元素各出一项，
 *       最多 maxItems 项；不足时用「充能/甜品」补位。
 */
export function buildPartyOrder(meals, team, { maxItems = 4, budgetCents = null } = {}) {
  const reaction = reactionOf(team);
  const picks = [];
  const usedNames = new Set();

  const orderedTeam = [...team];
  // 把提供 main 的元素提到最前，保证一定有主菜
  orderedTeam.sort((a, b) => {
    const sa = ELEMENTS[a].slot === 'main' ? 0 : 1;
    const sb = ELEMENTS[b].slot === 'main' ? 0 : 1;
    return sa - sb;
  });

  const teamToUse = orderedTeam.length ? orderedTeam : ['geo'];
  for (const elKey of teamToUse) {
    if (picks.length >= maxItems) break;
    const cands = candidatesForElement(meals, elKey, { limit: 8 });
    const hit = cands.find((c) => !usedNames.has(c.name));
    if (hit) {
      usedNames.add(hit.name);
      picks.push({ element: elKey, meal: hit.meal, name: hit.name, score: hit.score });
    }
  }

  // 补位：优先甜品（凑仪式感），再饮品
  for (const filler of ['cryo', 'hydro', 'electro']) {
    if (picks.length >= maxItems) break;
    if (teamToUse.includes(filler)) continue;
    const cands = candidatesForElement(meals, filler, { limit: 8 });
    const hit = cands.find((c) => !usedNames.has(c.name));
    if (hit) {
      usedNames.add(hit.name);
      picks.push({ element: filler, meal: hit.meal, name: hit.name, score: hit.score, filler: true });
    }
  }

  // 预算裁剪：超预算时从最贵的补位项开始砍，再砍最贵非主菜
  if (Number.isFinite(budgetCents) && budgetCents > 0) {
    const total = () => picks.reduce((s, p) => s + (mealPriceCents(p.meal) ?? 0), 0);
    const byExpense = () =>
      [...picks].sort((a, b) => (mealPriceCents(b.meal) ?? 0) - (mealPriceCents(a.meal) ?? 0));
    let guard = 12;
    while (total() > budgetCents && picks.length > 1 && guard-- > 0) {
      const pool = byExpense();
      const victim = pool.find((p) => p.filler) ?? pool.find((p) => ELEMENTS[p.element].slot !== 'main');
      if (!victim) break;
      picks.splice(picks.indexOf(victim), 1);
    }
  }

  const originalCents = picks.reduce((s, p) => s + (mealPriceCents(p.meal) ?? 0), 0);
  return { team: teamToUse, reaction, picks, originalCents };
}

export function elementStyle(elementKey) {
  const el = ELEMENTS[elementKey];
  return el ?? { zh: '?', full: '未知元素', hex: '#9aa4b2', taste: '-', motto: '' };
}
