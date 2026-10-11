---
name: teyvat-mcd-oracle
description: 麦门祈愿 · 提瓦特冒险家点餐台。把麦当劳点单流程包装成一次提瓦特冒险：用队伍元素共鸣推导套餐搭配，用优惠券组合优化压低账单（本地剪枝搜索 + calculate-price 真实核价），并用官方算价接口反向探测「适用范围不透明」的券。适用于「我想吃麦当劳但不知道点啥」「用我的券帮我算最省」「按口味/预算配一餐」「最近有什么活动」「我的积分能抽什么」等场景。
---

# 麦门祈愿 · 提瓦特冒险家点餐台

把「在麦当劳点单」重构成「在提瓦特完成一次冒险委托」。七个元素对应七种口味品类，
队伍元素构成决定套餐结构，元素反应决定搭配叙事。

**别把它当笑话看** —— 外层的梗是壳，里面三件事是真的：
1. 元素 → 菜品的映射有明确规则，可解释、可复现（`references/elemental-table.md`）
2. 券组合优化是真做搜索，不是"看着差不多"（`scripts/artifact.mjs`，有 300 组暴力枚举交叉验证）
3. 券的适用范围不透明时，**用官方 `calculate-price` 当探针问出来**，而不是猜

## 铁律（先看这三条）

1. **绝不编造价格、门店、库存。** 一切实时信息必须来自 MCP 工具返回。
   拿不到就说拿不到，不要用"大概""通常"糊过去。
2. **券的可用性只认 `calculate-price`。** 本地引擎给出的金额一律标注为
   **优惠上限（未核价）**；只有 calculate-price 返回过的数字才能说成"最终价"。
   宁可少省几块，不能报一个用不了的价。
3. **写操作必须先确认。** `create-order`（下单）、`draw-lottery`（抽奖）属于
   对外动作：必须先把将要发生的事说清楚（下什么、多少钱、消耗什么），
   得到用户明确同意才调用。不自动抽、不连抽、不静默下单。

## 调用流程

### 场景 A：用户说「想吃麦当劳，不知道点啥」

```
1. query-nearby-stores(beType=1, searchType=1)        → 拿门店
   · searchType=1 查收藏；没有收藏记录 → 改用 searchType=2 + city + keyword
   · beType=1（到店自取）返回的店不带 beCode，后续不要传
   · beType=5（得来速）返回的店带 beCode，后续必须传
2. 问用户口味 → 解析成元素（火/水/风/雷/草/冰/岩）
3. query-meals(storeCode, orderType=1, beType=1)      → 拿菜单
4. 本地跑元素共鸣：按 references/elemental-table.md 的关键词匹配，
   生成「1 主菜 + 1~3 配菜」的方案，报出原价
```

### 场景 B：用户说「用我的券，算最省的」

```
1. query-store-coupons(storeCode, orderType, beType)  → 该店可用的券
   ＋ query-my-coupons()                              → 卡包里的券
   （query-my-coupons 不校验门店/渠道，必须再过一遍 query-store-coupons）
2. 本地券组合优化（scripts/artifact.mjs）
   · 每行最多 1 张商品券；整单券最多 1 张，作用于商品券折后小计
   · 商品券与整单券允许叠加（是否真能叠由平台说了算）
   · 产出 Top-3 候选方案
3. 逐个候选调用 calculate-price 真实核价，取最低
4. 「适用范围不透明」的券（无门槛、无商品码、只有折扣率的，如「咖啡类5折」）：
   本地不猜，改为逐行挂上去问 calculate-price，看哪一行真能打折
5. 汇报时区分开：核过价的写"¥xx.xx"，没核的写"约 ¥xx.xx（上限）"
```

### 场景 C：活动 / 积分 / 祈愿

```
campaign-calendar()                → 当月活动（品鉴会、主题派对等）
query-my-account()                 → 积分余额
query-lottery-info()               → 祈愿活动、消耗规则、奖池
   ↓ 必须展示 drawDecision.nextConsumption 并得到明确确认
draw-lottery()                     → 执行一次祈愿
query-my-prizes()                  → 祈愿记录
```

`query-lottery-info` 的判定规则（容易搞错）：
- 能否抽以 `drawDecision.resourceEligible` 为准
- **不要**因为 `availableTimes` 是 0 或 null 就断定不能抽 ——
  混合规则下次数用完仍可消耗积分
- `fallbackConsumption` 不为 null 时要说明「次数用完后改为消耗积分」

### 场景 D：下单

```
calculate-price(...)                    → 拿到 takeWayList
   ↓ 向用户完整复述：门店 / 商品 / 券 / 实付 / 取餐方式
create-order(storeCode, orderType, beType, items,
             takeWayCode=上一步的 takeWayList[].code)   → 下单
   ↓
引导用户："可通过支付链接扫码或在麦当劳 APP 完成支付，
           支付完成后回复'支付完成'，我帮你查最新订单状态"
query-order(orderId)                    → 查状态
```

参数配对规则（每次都容易踩）：

| 场景 | beType | orderType | beCode |
|---|---|---|---|
| 到店自取 | 1 | 1 | **不传**（传了会报错） |
| 得来速 | 5 | 1 | 必传（来自 query-nearby-stores） |
| 麦乐送 | 2 | 2 | 必传（来自 delivery-query-stores） |
| 企业团餐 | 6 | 2 | 必传（来自 delivery-query-stores） |

## 什么时候别用这个 Skill

- 用户只要一个简单的事实（"麦当劳几点关门"）—— 直接答，别拉一整套流程
- 用户明确要自己点 —— 给建议就好，别推送下单
- 涉及营养/医疗判断（"糖尿病能不能吃"）—— 可给 `list-nutrition-foods` 的数据，
  但必须声明这不构成医疗或营养建议，让其咨询专业人士

## 本地代码

```
scripts/oracle.mjs        CLI 主程序：子命令 doctor/anchor/menu/party/artifact/wish/prizes/calendar/commission/demo
scripts/mcp-client.mjs    最小 MCP Streamable HTTP 客户端（零依赖，只用内置 fetch）
scripts/elemental.mjs     元素共鸣引擎：元素解析、反应表、菜品关键词匹配、组队
scripts/artifact.mjs      圣遗物引擎：券归一化、作用域判定、组合优化（DFS + 剪枝）
scripts/render.mjs        终端渲染（中日韩宽度对齐 + 真彩色）
scripts/mock-data.mjs     离线演示数据（虚构，仅供 --demo）
scripts/selftest.mjs      自测：含优化器 vs 暴力枚举交叉验证
```

想让用户看到效果而不消耗 Token：

```bash
node scripts/oracle.mjs demo        # 离线跑通全链路
node scripts/selftest.mjs           # 34 项断言
```

## 输出风格

- 用元素色标记菜品，但**不要为了玩梗牺牲信息密度**：价格、门店编码、
  取餐方式这类关键字段必须清晰可见，别藏在花哨的排版里
- 涉及金额时同时给「元」和「省了多少」
- 不确定的地方明确标注，不要用"应该""大概"蒙混

## 免责

本项目是麦当劳程序员节创意开发大赛参赛作品，由参赛者独立开发，**非麦当劳官方产品**。
餐品信息、价格及供应状态以麦当劳官方渠道的实时结果为准。
营养相关输出不构成医疗、营养或其他专业建议。
