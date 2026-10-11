/**
 * 离线演示数据（DEMO / MOCK）
 *
 * ⚠️ 用途与边界：
 *  - 这些数据是**虚构的示例数据**，商品编码、价格、券面均为演示编写，
 *    与麦当劳官方实时信息无关，不得用于任何真实下单决策。
 *  - 存在意义：让评委 / 用户在没有 MCP Token 的情况下也能 `--demo`
 *    完整跑通「锚点 → 图鉴 → 共鸣 → 强化 → 祈愿 → 委托」全链路。
 *  - 接入真实 Token 后，所有数据一律来自 https://mcp.mcd.cn，本文件不再参与。
 *
 * 价格单位统一为「分」。
 */

export const MOCK = true;

export const MOCK_NOTE = '当前为离线演示数据（虚构示例，非麦当劳官方实时信息）';

export const stores = [
  {
    storeCode: '1000123',
    storeName: '济南泉城路麦乐广场餐厅',
    address: '山东省济南市历下区泉城路 188 号',
    beCode: null,
    beType: 1,
    reservation: false,
    today: true,
    distance: '480m',
  },
  {
    storeCode: '1000456',
    storeName: '济南经十路得来速餐厅',
    address: '山东省济南市市中区经十路 2000 号',
    beCode: 'DT1000456',
    beType: 5,
    reservation: true,
    reservationTimeOptions: ['今天 18:30', '今天 19:00', '今天 19:30'],
    today: true,
    distance: '1.9km',
  },
];

export const meals = [
  { code: '1001', name: '巨无霸', price: 2550, category: '汉堡' },
  { code: '1002', name: '双层吉士汉堡', price: 1850, category: '汉堡' },
  { code: '1003', name: '安格斯厚牛堡', price: 3500, category: '汉堡' },
  { code: '1004', name: '麦辣鸡腿堡', price: 2550, category: '汉堡' },
  { code: '1005', name: '板烧鸡腿堡', price: 2550, category: '汉堡' },
  { code: '1006', name: '原味鸡腿堡', price: 2200, category: '汉堡' },
  { code: '1007', name: '麦香鸡', price: 1450, category: '汉堡' },
  { code: '1008', name: '麦乐鸡（5块）', price: 1250, category: '小食' },
  { code: '1009', name: '麦辣鸡翅（2块）', price: 1350, category: '小食' },
  { code: '1010', name: '香骨鸡腿', price: 1300, category: '小食' },
  { code: '2001', name: '薯条（中）', price: 1200, category: '小食' },
  { code: '2002', name: '薯条（大）', price: 1500, category: '小食' },
  { code: '2003', name: '玉米杯', price: 850, category: '小食' },
  { code: '2004', name: '鲜蔬沙拉', price: 1450, category: '轻食' },
  { code: '2005', name: '苹果片', price: 750, category: '轻食' },
  { code: '3001', name: '原味甜筒', price: 600, category: '甜品' },
  { code: '3002', name: '奥利奥麦旋风', price: 1250, category: '甜品' },
  { code: '3003', name: '草莓新地', price: 1050, category: '甜品' },
  { code: '3004', name: '香芋派', price: 850, category: '甜品' },
  { code: '3005', name: '巧克力圣代', price: 1100, category: '甜品' },
  { code: '4001', name: '可口可乐（中）', price: 950, category: '饮品' },
  { code: '4002', name: '雪碧（中）', price: 950, category: '饮品' },
  { code: '4003', name: '柠檬红茶', price: 1050, category: '饮品' },
  { code: '4004', name: '鲜煮咖啡（中）', price: 1200, category: '饮品' },
  { code: '4005', name: '拿铁咖啡', price: 1850, category: '饮品' },
  { code: '4006', name: '美式咖啡', price: 1450, category: '饮品' },
  { code: '4007', name: '橙汁', price: 1250, category: '饮品' },
  { code: '4008', name: '矿泉水', price: 700, category: '饮品' },
  { code: '5001', name: '巨无霸套餐', price: 3950, category: '套餐' },
  { code: '5002', name: '麦辣鸡腿堡套餐', price: 3950, category: '套餐' },
  { code: '5003', name: '开心乐园餐', price: 3200, category: '套餐' },
];

/** 门店可用券（对应 query-store-coupons） */
export const storeCoupons = [
  { couponId: 'SC001', couponCode: 'MCD30R5', name: '满30元减5元', minAmount: 30, discountAmount: 5 },
  { couponId: 'SC002', couponCode: 'MCD50R12', name: '满50元减12元', minAmount: 50, discountAmount: 12 },
  { couponId: 'SC003', couponCode: 'BIGMAC8', name: '巨无霸立减8元', productCodes: ['1001'], discountAmount: 8 },
  { couponId: 'SC004', couponCode: 'FRIES5', name: '中薯立减5元', productCodes: ['2001'], discountAmount: 5 },
  { couponId: 'SC005', couponCode: 'COFFEE50', name: '咖啡类5折', discountRate: 0.5 },
  { couponId: 'SC006', couponCode: 'NUGGET6', name: '麦乐鸡立减6元', productCodes: ['1008'], discountAmount: 6 },
  { couponId: 'SC007', couponCode: 'CONE3', name: '甜筒立减3元', productCodes: ['3001'], discountAmount: 3 },
  { couponId: 'SC008', couponCode: 'HOTWING4', name: '麦辣鸡翅立减4元', productCodes: ['1009'], discountAmount: 4 },
];

/** 我的卡包券（对应 query-my-coupons） */
export const myCoupons = [
  ...storeCoupons.slice(0, 5),
  { couponId: 'MC101', couponCode: 'VIP9R10', name: '会员满35元减10元', minAmount: 35, discountAmount: 10 },
  { couponId: 'MC102', couponCode: 'SALAD4', name: '鲜蔬沙拉立减4元', productCodes: ['2004'], discountAmount: 4 },
];

/** 麦麦省可领券（对应 available-coupons） */
export const availableCouponList = [
  { couponId: 'AC001', couponCode: 'NEW50R8', name: '新客满50元减8元', minAmount: 50, discountAmount: 8 },
  { couponId: 'AC002', couponCode: 'DESSERT3', name: '任意甜品立减3元', productCodes: ['3002', '3003', '3004', '3005'], discountAmount: 3 },
];

export const account = {
  memberLevel: '麦金会员 · 金卡',
  availablePoint: 1580,
  totalPoint: 3260,
  expiringPoint: 320,
  expiringDate: '2026-10-31',
};

export const lotteryInfo = {
  activityCode: 'LOT202610',
  activityName: '麦门祈愿 · 积分祈愿祭',
  activityStatusText: '进行中',
  beginTime: '2026-10-01 00:00',
  endTime: '2026-10-25 23:59',
  drawPoint: 200,
  drawTypeText: '先消耗次数再消耗积分抽奖',
  availableTimes: 1,
  availablePoint: 1580,
  drawDecision: {
    resourceEligible: true,
    nextConsumption: { type: 'TIMES', amount: 1, text: '消耗 1 次祈愿机会' },
    fallbackConsumption: { type: 'POINTS', amount: 200, text: '次数用完后改为消耗 200 积分' },
  },
  prizes: [
    { name: '薯条（中）免费券', typeText: '餐品券' },
    { name: '巨无霸买一送一券', typeText: '餐品券' },
    { name: '麦旋风立减5元券', typeText: '优惠券' },
    { name: '666 积分', typeText: '积分' },
    { name: '麦门限定徽章', typeText: '实物周边' },
  ],
};

export const lotteryResult = {
  status: { code: 'SUCCESS', message: '抽奖成功' },
  win: true,
  prizes: [
    {
      name: '薯条（中）免费券',
      typeText: '餐品券',
      validDateInfo: '有效期至 2026-11-10',
    },
  ],
};

export const myPrizes = {
  prizes: [
    { id: 'P01', name: '薯条（中）免费券', status: 'UNUSED', statusText: '可用', recordTime: '2026-10-11 21:52' },
    { id: 'P02', name: '666 积分', status: 'RECEIVED', statusText: '已领取', recordTime: '2026-10-08 12:03' },
    { id: 'P03', name: '麦旋风立减5元券', status: 'EXPIRED', statusText: '已过期', recordTime: '2026-09-20 19:40' },
  ],
  pageNum: 1,
  pageSize: 10,
  hasMore: false,
};

export const campaignCalendar = [
  {
    date: '2026-10-11',
    title: '麦门祈愿 · 积分祈愿祭',
    status: '进行中',
    desc: '积分祈愿抽奖，奖池含免费薯条券与限定周边',
  },
  {
    date: '2026-10-18',
    title: '品鉴会 · 新品试吃',
    status: '即将开始',
    desc: '到店品鉴新品汉堡，需提前预约',
  },
  {
    date: '2026-10-24',
    title: '程序员节限定 · 汉堡回车键',
    status: '未来',
    desc: '程序员节周边兑换活动',
  },
];

/** 历史订单（对应 order-list） */
export const orderHistory = {
  orders: [
    { orderId: 'MCD20261008001', storeName: '济南泉城路麦乐广场餐厅', total: 3950, status: '已完成', createTime: '2026-10-08 12:20' },
    { orderId: 'MCD20261003002', storeName: '济南泉城路麦乐广场餐厅', total: 2450, status: '已完成', createTime: '2026-10-03 19:05' },
  ],
};

export const mealAssistance = [
  { gmServiceCode: 'GM01', name: '团餐专人配送', desc: '专人送达指定楼层' },
  { gmServiceCode: 'GM02', name: '分餐装盒', desc: '按人数分装，便于分发' },
];

export const pointsProducts = [
  { spuId: 9001, name: '巨无霸兑换券', point: 800, catRuleId: '1>4' },
  { spuId: 9002, name: '麦旋风兑换券', point: 500, catRuleId: '1>4' },
  { spuId: 9003, name: '麦门限定徽章', point: 1500, catRuleId: '2>8' },
];

export function mockCommissionPreview(cart, totalCents) {
  return {
    orderId: 'MCD' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + 'DEMO',
    status: '待支付',
    totalCents,
    takeWayList: [
      { code: 'TW01', name: '到店取餐' },
      { code: 'TW02', name: '堂食' },
    ],
    payUrl: 'https://example.invalid/demo-pay（演示占位，非真实支付链接）',
    items: cart,
  };
}
