/**
 * 圣遗物强化引擎 —— 优惠券组合优化
 *
 * 现实中的券是「不透明」的：满减 / 单品券 / 折扣券 / 限定商品券混在一起，
 * 而且拿到的字段名各接口还不统一。所以本引擎采取**两段式**策略：
 *
 *   第一段（本地，快）：把券按语义粗分类，用 DFS 在「商品 × 券」的分配空间里
 *                      剪枝搜索，产出一批**候选方案**（Top-K），只做排序不做裁决。
 *   第二段（远端，权威）：把候选方案交给麦当劳 calculate-price 真实算价，
 *                      以官方返回的金额为最终结论。
 *
 * 这样即使券字段解析不准，最终价格也不会错 —— 最多是漏掉某个更优组合，
 * 而不会给出一个「看起来省了钱、其实下不了单」的假结论。
 *
 * 叠加语义（本地搜索遵循的规则）：
 *   · 同一行最多挂 1 张商品券；同一张券只能用一次
 *   · 整单券最多 1 张，作用于「商品券折后」的小计，门槛也按该小计判断
 *   · 商品券与整单券是两张不同的券，**允许叠加** —— 真实平台是否允许、
 *     门槛按折前还是折后算，各活动不一样。所以本地结果只是**优惠上限**，
 *     真实可不可用一律交给 calculate-price 裁决（见 oracle.mjs）。
 */

// ------------------------------------------------------------------ 归一化

const NAME_KEYS = ['name', 'couponName', 'title', 'couponTitle', 'displayName', 'desc'];
const CID_KEYS = ['couponId', 'id', 'cardId'];
const CCODE_KEYS = ['couponCode', 'code', 'cardNo', 'couponNo'];
const MIN_KEYS = ['minAmount', 'threshold', 'limitAmount', 'useCondition', 'conditionAmount', 'minConsume'];
const DISC_KEYS = ['discountAmount', 'discount', 'amount', 'faceValue', 'reduceAmount', 'saveAmount', 'cut'];
const RATE_KEYS = ['discountRate', 'rate', 'discountPercent', 'zhe'];
const PROD_KEYS = ['productCodes', 'products', 'items', 'skuCodes', 'mealCodes', 'applyProducts'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickKey(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * 把任意形状的券列表压成引擎内部结构。
 * 解析不出来的部分一律留空（null），由第二段真实算价兜底。
 */
export function normalizeCoupons(list, { priceUnit = 'auto' } = {}) {
  const arr = Array.isArray(list) ? list : [];
  const toCents = (v) => {
    const n = num(v);
    if (n === null) return null;
    if (priceUnit === 'cents') return Math.round(n);
    if (priceUnit === 'yuan') return Math.round(n * 100);
    // 满减券一般 5~50 元；若数值 ≥ 200 基本可判定为分
    return n >= 200 ? Math.round(n) : Math.round(n * 100);
  };

  return arr.map((raw, idx) => {
    const name = pickKey(raw, NAME_KEYS) ?? `未命名券#${idx + 1}`;
    const couponId = pickKey(raw, CID_KEYS);
    const couponCode = pickKey(raw, CCODE_KEYS);

    const minAmountCents = toCents(pickKey(raw, MIN_KEYS));
    const discountCents = toCents(pickKey(raw, DISC_KEYS));

    let discountRate = num(pickKey(raw, RATE_KEYS));
    if (discountRate !== null && discountRate > 1) discountRate = discountRate / 100;
    if (discountRate !== null && discountRate >= 1 && discountRate <= 10) {
      // 「8折」被当成 8 传过来的情况
      discountRate = discountRate / 10;
    }

    const rawProducts = pickKey(raw, PROD_KEYS);
    const productCodes = Array.isArray(rawProducts)
      ? rawProducts
          .map((p) => (typeof p === 'string' ? p : pickKey(p, ['productCode', 'code', 'mealCode', 'id'])))
          .filter(Boolean)
          .map(String)
      : [];

    // ---- 作用域判定 -------------------------------------------------------
    // 券的适用范围在接口里经常是「不透明」的（只有一个名字）。判错的代价不对称：
    //   · 把整单券误判成单品券 → 少算优惠（结论偏保守，不会翻车）
    //   · 把品类券误判成整单券 → 「咖啡类5折」变成整单 5 折，估算直接翻倍虚高
    // 所以这里一律往保守的方向倒：
    //   · 明确列了适用商品       → 商品券
    //   · 有满减门槛             → 整单券（满减本质作用于订单小计）
    //   · 只有折扣率、没有门槛   → 未知品类券（uncertain），只允许落在「最低价那一行」
    //   · 其余                   → 通配单品券
    let scope;
    let uncertain = false;
    if (productCodes.length) {
      scope = 'product';
    } else if (minAmountCents) {
      scope = 'order';
    } else if (discountRate !== null) {
      scope = 'product';
      uncertain = true;
    } else {
      scope = 'product';
    }

    return {
      index: idx,
      name: String(name),
      couponId: couponId === undefined ? null : String(couponId),
      couponCode: couponCode === undefined ? null : String(couponCode),
      scope,
      uncertain,
      productCodes,
      minAmountCents,
      discountCents,
      discountRate,
      raw,
    };
  });
}

export function couponRef(c) {
  return { couponId: c.couponId ?? undefined, couponCode: c.couponCode ?? undefined };
}

export function describeCoupon(c) {
  const parts = [];
  if (c.minAmountCents) parts.push(`满${(c.minAmountCents / 100).toFixed(0)}元`);
  if (c.discountCents) parts.push(`减${(c.discountCents / 100).toFixed(1)}元`);
  if (c.discountRate !== null) parts.push(`${(c.discountRate * 10).toFixed(1)}折`);
  if (!parts.length) parts.push('规则未识别');
  if (c.scope === 'product' && c.productCodes.length) parts.push(`限${c.productCodes.length}个商品`);
  if (c.uncertain) parts.push('适用品类未知');
  return parts.join(' · ');
}

// ------------------------------------------------------------------ 算价

/** 应用单品券到一行，返回该行实付（分） */
function applyLineCoupon(line, coupon) {
  const gross = line.unitPriceCents * line.quantity;
  if (!coupon) return gross;
  if (coupon.discountCents) return Math.max(0, gross - coupon.discountCents);
  if (coupon.discountRate !== null) return Math.max(0, Math.round(gross * coupon.discountRate));
  return gross;
}

function eligibleLineCoupons(line, coupons) {
  return coupons.filter((c) => {
    if (c.scope !== 'product') return false;
    // 适用品类未知的折扣券（如「咖啡类5折」）：本地无从推断它到底能打哪些商品。
    // 硬猜只会给出荒唐组合（把咖啡券配到甜筒上），所以干脆不参与本地搜索，
    // 改由线上 calculate-price 逐个探测真实适用范围。见 oracle.mjs 的 probeUncertain()。
    if (c.uncertain) return false;
    if (!c.productCodes.length) return true; // 通配单品券
    return c.productCodes.includes(String(line.productCode));
  });
}

function orderCouponsFor(subtotalCents, coupons, used) {
  return coupons
    .filter((c) => c.scope === 'order' && !used.has(c.index))
    .map((c) => {
      const meets = !c.minAmountCents || subtotalCents >= c.minAmountCents;
      let pay = subtotalCents;
      if (meets) {
        if (c.discountCents) pay = Math.max(0, subtotalCents - c.discountCents);
        else if (c.discountRate !== null) pay = Math.max(0, Math.round(subtotalCents * c.discountRate));
      }
      return { coupon: c, payable: pay, meets };
    })
    .sort((a, b) => a.payable - b.payable);
}

// ------------------------------------------------------------------ 搜索

/**
 * @param {Array} cart   [{ id, productCode, name, unitPriceCents, quantity }]
 * @param {Array} coupons normalizeCoupons() 的输出
 * @returns {{ originalCents, plans: Array, stats: object }}
 */
export function optimizeCart(cart, coupons, { topK = 3, maxNodes = 250000, perLineLimit = 6 } = {}) {
  const originalCents = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
  const plans = [];
  const stats = { nodes: 0, truncated: false };

  // 本地推断不了适用范围的券，单独拎出来交给线上探测
  const uncertain = coupons.filter((c) => c.uncertain);

  // 无券基线：至少有一个方案可比
  plans.push({ finalCents: originalCents, lines: cart.map((l) => ({ ...l, coupon: null })), savedCents: 0, source: 'baseline' });

  // 每行的候选券：按「单行省得最多」排序后截断，控制搜索宽度
  const lineOptions = cart.map((line) => {
    const cands = eligibleLineCoupons(line, coupons)
      .map((c) => ({ coupon: c, payable: applyLineCoupon(line, c) }))
      .sort((a, b) => a.payable - b.payable)
      .slice(0, perLineLimit);
    return [{ coupon: null, payable: line.unitPriceCents * line.quantity }, ...cands];
  });

  const used = new Set();
  const chosen = new Array(cart.length).fill(null);

  const pushPlan = () => {
    const lines = cart.map((l, i) => ({
      ...l,
      coupon: chosen[i],
      payableCents: applyLineCoupon(l, chosen[i]),
    }));
    const itemSubtotal = lines.reduce((s, l) => s + l.payableCents, 0);
    const orderCands = orderCouponsFor(itemSubtotal, coupons, used);
    const best = orderCands[0];
    const finalCents = best ? best.payable : itemSubtotal;

    // 让「基线」不被同价方案挤掉：同价时优先无券，方便对比
    const sig = [
      lines.map((l) => l.coupon?.index ?? '-').join(','),
      best && best.meets ? best.coupon.index : '-',
    ].join('|');
    if (plans.some((p) => p.sig === sig)) return;

    plans.push({
      sig,
      lines,
      orderCoupon: best && best.meets ? best.coupon : null,
      itemSubtotalCents: itemSubtotal,
      finalCents,
      savedCents: originalCents - finalCents,
      source: 'local-search',
    });
  };

  const dfs = (i) => {
    if (stats.nodes++ > maxNodes) {
      stats.truncated = true;
      return;
    }
    if (i === cart.length) {
      pushPlan();
      return;
    }
    for (const opt of lineOptions[i]) {
      const c = opt.coupon;
      if (c && used.has(c.index)) continue;
      if (c) used.add(c.index);
      chosen[i] = c;
      dfs(i + 1);
      chosen[i] = null;
      if (c) used.delete(c.index);
      if (stats.truncated) return;
    }
  };

  dfs(0);

  plans.sort((a, b) => a.finalCents - b.finalCents || a.savedCents - b.savedCents);
  return { originalCents, plans: plans.slice(0, topK + 1), uncertainCoupons: uncertain, stats };
}

export const MORA_PER_YUAN = 1000;
export const centsToYuan = (c) => c / 100;
export const centsToMora = (c) => Math.round((c / 100) * MORA_PER_YUAN);
export const fmtYuan = (c) => `¥${(c / 100).toFixed(2)}`;
