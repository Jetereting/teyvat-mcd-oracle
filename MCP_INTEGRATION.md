# 麦当劳 MCP 集成说明

本文说明本项目**实际**使用了哪些麦当劳 MCP 能力、怎么调、以及它解决了什么业务问题。

## 一、MCP Server

| 项 | 值 |
|---|---|
| 服务地址 | `https://mcp.mcd.cn` |
| 传输协议 | MCP Streamable HTTP |
| 鉴权 | `Authorization: Bearer <MCD_MCP_TOKEN>` |
| 客户端实现 | `scripts/mcp-client.mjs`（自研，**零依赖**，仅用 Node 18+ 内置 `fetch` / `ReadableStream`） |

自研客户端的原因：本项目要证明「**真实调用**了麦当劳 MCP」，
而不是"在 WorkBuddy 里点了下连接器"。任何装了 Node 18+ 的机器，
clone 下来配一个 Token 就能跑通全链路，不依赖任何第三方 SDK。

实现覆盖的协议要点：

1. `initialize` 握手，从响应头 `mcp-session-id` 建立会话
2. `notifications/initialized` 通知（无 id，服务端可不响应）
3. 后续所有请求携带 `mcp-session-id`
4. 响应**同时支持** `application/json` 与 `text/event-stream`（SSE）两种形态 ——
   流式响应逐帧解析，命中请求 id 后主动 `cancel()` 释放连接

## 二、实际调用的 Tool

12 个业务工具 + 4 个协议方法。**没有一个是"列在文档里但代码里没调"的**。

### 查询类（只读）

| Tool | 本项目里的用途 | 代码位置 |
|---|---|---|
| `query-nearby-stores` | 传送锚点：定位可点餐门店，区分到店自取 / 得来速 | `cmdAnchor` / `fetchStores` |
| `query-meals` | 料理图鉴：拉取门店在售餐品，喂给元素匹配引擎 | `fetchMeals` |
| `campaign-calendar` | 活动秘境：当月进行中 / 即将开始的营销活动 | `cmdCalendar` |
| `query-my-account` | 冒险家档案：积分余额与到期提示 | 见 SKILL.md 场景 C |

### 优惠券类（读 + 一次显式写）

| Tool | 本项目里的用途 | 代码位置 |
|---|---|---|
| `query-store-coupons` | 该门店 + 该渠道**真正可用**的券（唯一可信的券来源） | `cmdArtifact` |
| `query-my-coupons` | 卡包券；**不校验门店渠道，必须再过一层 `query-store-coupons`** | `cmdArtifact` |
| `available-coupons` | 麦麦省未领取的券（只查不领） | `cmdArtifact` |
| `auto-bind-coupons` | 一键领券。**账号写操作，仅在用户显式加 `--bind-coupons` 时执行** | `cmdArtifact` |

### 计价与订单

| Tool | 本项目里的用途 | 代码位置 |
|---|---|---|
| `calculate-price` | **核心**。两个角色：① 给候选券组合真实核价 ② 反向探测"适用范围不透明"的券 | `cmdArtifact` |
| `create-order` | 提交订单（默认只预览，`--confirm` 才真下单） | `cmdCommission` |
| `query-order` | 支付后查订单状态 | `cmdCommission` 后续引导 |

### 祈愿（抽奖）

| Tool | 本项目里的用途 | 代码位置 |
|---|---|---|
| `query-lottery-info` | 祈愿活动、消耗规则、奖池、`drawDecision` | `cmdWish` |
| `draw-lottery` | 执行**一次**祈愿（须先展示 `nextConsumption` 并获明确同意） | `cmdWish` |
| `query-my-prizes` | 祈愿记录（可用 / 已使用 / 已过期） | `cmdWish` / `cmdPrizes` |

## 三、调用流程（真实时序）

### 主链路：从"不知道吃啥"到"最优账单"

```
① query-nearby-stores(beType=1, searchType=1)
   └ 无收藏记录时退化为 searchType=2 + city + keyword
        ↓ storeCode（beType=1 不带 beCode，后续不传）
② query-meals(storeCode, orderType=1, beType=1)
        ↓ 在售餐品列表
   ┌─ 本地：元素共鸣引擎（elemental.mjs）
   │   · 按关键词把餐品映射到 7 个元素
   │   · 队伍元素 → 1 主菜 + 1~3 配菜，报原价
   └──────────────────────────────────────────┐
③ query-store-coupons(storeCode, orderType, beType)  ← 门店可用券
   + query-my-coupons()                              ← 卡包券
   + available-coupons()                             ← 未领券（只读）
        ↓
   ┌─ 本地：券组合优化（artifact.mjs）
   │   · 券归一化 + 作用域判定（见 references/coupon-optimization.md）
   │   · DFS 剪枝搜索 → Top-3 候选方案
   └──────────────────────────────────────────┘
        ↓
④ calculate-price(storeCode, orderType, beType, items, needTableware=false)
   ├ 4a. 逐个候选方案核价 → 取真实最低
   └ 4b. 逐行探测 uncertain 券（最多 --max-probes 次，默认 8）
        ↓ 以官方返回金额为准
   「★ 最优 ¥44.50　省 ¥15.00」
        ↓ 用户确认
⑤ create-order(storeCode, orderType, beType, items, takeWayCode=④的 takeWayList[].code)
        ↓ 返回 orderId / payUrl
⑥ 用户支付后 query-order(orderId) 查最新状态
```

### 支线：祈愿

```
query-lottery-info()
  → 展示 activityName / 消耗规则 / 奖池 / drawDecision.nextConsumption
  → resourceEligible=false 则中止，不调用 draw-lottery
  → 用户明确同意
draw-lottery()          ← 一次，不试抽、不连抽
query-my-prizes()       ← 祈愿记录
```

## 四、参数配对规则（最容易出错的地方）

`beType` / `orderType` / `beCode` 三者必须配对，配错直接报错：

| 场景 | beType | orderType | beCode | 说明 |
|---|---|---|---|---|
| 到店自取 | 1 | 1 | **不传** | 传了会报错 |
| 得来速 | 5 | 1 | 必传 | 来自 `query-nearby-stores` |
| 麦乐送 | 2 | 2 | 必传 | 来自 `delivery-query-stores` |
| 企业团餐 | 6 | 2 | 必传 | 来自 `delivery-query-stores` |

代码里用 `if (beType !== 1) args.beCode = store.beCode;` 统一收口，
避免四个调用点各写一遍、然后漏掉一处。

另外两处平台约束：

- **`query-store-coupons` 的 `storeCode` 必须全数字**（工具描述里明确要求）
- **`draw-lottery` 严禁"试抽"**：必须先展示 `drawDecision.nextConsumption`，
  `resourceEligible=false` 时不得调用；不得根据 `availableTimes` 为 0/null
  或 `drawTypeText` 自行判断能否抽（混合规则下次数用完仍可消耗积分）

## 五、工程上处理的两个现实问题

### 1. 返回字段名不统一

麦当劳 MCP 各工具的返回结构不完全一致（有的在 `data.meals`，有的在
`data.list`，列表还可能嵌在 `categories[].products` 里）。硬编码字段名
一定会随接口调整而挂掉。

处理方式（`mcp-client.mjs`）：

- `pick(obj, [候选键...])` —— 按候选键列表取第一个非空值
- `deepFind(node, predicate)` —— 深度搜索第一个满足条件的值
- `firstArray(payload, [候选键...])` —— 先试已知键，再退化为"深度搜索第一个非空对象数组"
- `normalizeCents()` —— 价格单位用中位数启发式判断（分 / 元），
  避免把 25 元算成 0.25 元
- `query-meals` 的结果额外做了一层**递归展平**，兼容"分类 → 商品"的嵌套结构

代价是代码稍长；收益是接口微调不会让整个项目失效。

### 2. 券的适用范围不透明 —— 用算价接口反向探测

**这是本项目最有价值的一处工程设计。**

现实：券的元数据经常只有一个名字，没有适用商品、没有门槛。
典型样本「咖啡类5折」——你没法从接口知道它能打什么。

处理方式分两层：

**第一层：本地保守判定**
判错的代价不对称 —— 把整单券当单品券只是少算优惠（安全）；
把品类券当整单券会让估算翻倍虚高（危险，本项目开发时真踩过这个坑，
¥59.50 被算成 ¥28.75）。所以所有不确定判断一律往保守方向倒：
无门槛 + 无商品码 + 只有折扣率的券，标记 `uncertain`，**不参与本地估价**。

**第二层：拿 `calculate-price` 当探针**

```
对每张 uncertain 券 × 购物车每一行：
    构造「只在该行挂这张券」的 items → calculate-price → 对比原价
        变便宜 = 这张券真能作用在这一行，省多少是官方说的
        没变化 = 用不了
```

把接口的不透明性当成一个**可以被实验解决的问题**，而不是靠猜或写死规则。
探测到的可用组合会作为真实方案重新参与排序。

### 3. 两段式结论不混排

只要拿到了真实核价结果，就**只展示核价过的方案**；一个都没核成，
才退回本地估算，并明确标注「上限 · 未核价」。
混排的后果是用户分不清哪个数字能信 —— 那还不如不给数字。

## 六、业务价值

| 用户问题 | 传统做法 | 本项目 |
|---|---|---|
| 今天吃什么 | 自己在几十个单品里翻 | 报出队伍元素 → 直接给一套搭配及理由 |
| 我的券怎么用最划算 | 靠感觉，或逐张试 | 组合搜索 + 官方核价，给出可验证的最低价 |
| 这张券到底能不能用 | 下单才知道 | **下单前用 calculate-price 探测出来** |
| 有哪些券没领 | 不知道 | 主动提示"还有 N 张没领" |
| 这个月有什么活动 | 翻 App | 一条命令拉出活动日历 |

核心的差异化在于**结果可验证**：给出的每一个金额，
要么来自官方 `calculate-price`，要么明确标注为未核价的估算上限。没有中间地带。

## 七、边界与合规

- **本项目不是麦当劳官方产品**，是程序员节创意开发大赛参赛作品
- **不存储、不上传任何用户数据**：Token 从环境变量读取，不落盘；
  `--demo` 模式的所有数据都是本地虚构的示例数据，与官方无关
- **写操作全部默认关闭**：`create-order` 需 `--confirm`，
  `draw-lottery` 需 `--draw`，`auto-bind-coupons` 需 `--bind-coupons`。
  默认行为一律是"只读 + 预览"
- **未使用的能力（有意为之）**：麦乐送地址管理（`delivery-*`）、
  积分商城（`mall-*`）、主题派对（`party-*`）、企业团餐（团餐相关）。
  这些涉及下单外的履约链路，超出了本项目"点一餐"的范围，
  为控制范围没有实现 —— 而不是不知道它们存在
- 营养类输出（`list-nutrition-foods`）仅作数据展示，不构成医疗或营养建议
