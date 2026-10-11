# WorkBuddy 开发对话上下文

> 本文件记录项目在腾讯 WorkBuddy 中完成创意构思、开发与调试的实际过程，
> 用于核验本作品符合大赛「WorkBuddy 专项奖励」的联动活动条件。
>
> 项目同时在 WorkBuddy 中作为 **Skill** 运行（见 `SKILL.md`），
> 并通过 WorkBuddy 的**自定义连接器**接入麦当劳 MCP（`mcd-mcp`，Streamable HTTP）。

---

## 一、开发平台信息

| 项 | 值 |
|---|---|
| 开发平台 | 腾讯 WorkBuddy |
| 接入方式 | 左侧边栏【专家·技能·连接器】→【连接器】→【自定义连接器】→【配置 MCP】 |
| 连接器名称 | `mcd-mcp` |
| 服务地址 | `https://mcp.mcd.cn`（Streamable HTTP） |
| Skill 形态 | 仓库根目录 `SKILL.md`，可直接 `cp -r` 到 `~/.workbuddy/skills/` 使用 |

## 二、开发过程纪要

### 第 1 轮：需求与规则对齐

**用户**：给出大赛仓库地址，要求做一个「原神和麦当劳联动」方向的报名项目。

**WorkBuddy 的动作**：
- 拉取并通读大赛 `README.md`、`activityGuidelines.md`、`CONTEST_DECLARATION.md`
- 逐条提取硬性要求，发现**两处官方文档口径不一致**：
  `README.md` 的必备文件表里没有 `mcp-config.example.json`，
  但 `activityGuidelines.md` 里列了 —— 按更严的口径准备，两份都满足
- 清点可用的麦当劳 MCP 工具，按语义域分成：门店 / 菜单 / 券 / 计价 / 订单 / 祈愿 / 活动 / 商城
- 查询 WorkBuddy 当前连接器状态，确认 `mcd-mcp` **尚未绑定**
  → 据此确定了「真实 MCP 客户端 + 可离线验收的演示模式」这一架构前提

### 第 2 轮：方案设计与架构选型

**WorkBuddy 的动作**：
- 把「原神联动」这个主题落到可用的 MCP 能力上，形成「提瓦特冒险」映射表
  （传送锚点 / 料理图鉴 / 元素共鸣 / 圣遗物强化 / 祈愿台 / 冒险家委托）
- 选定「零依赖」技术路线：只用 Node 18+ 内置 `fetch`，自研最小 MCP 客户端 ——
  目的是让评委 `git clone` 后无需 `npm install` 即可跑通，可验证性最高
- 确定**两段式**核心架构（本地剪枝搜索 → 官方 `calculate-price` 核价），
  理由是：币券规则不透明，本地算得再多也不能作为最终结论

### 第 3 轮：核心引擎实现

**WorkBuddy 产出**：
- `scripts/mcp-client.mjs` —— 覆盖 `initialize` 握手、`mcp-session-id` 会话、
  以及 `application/json` 与 `text/event-stream` 双形态响应解析
- `scripts/elemental.mjs` —— 七元素映射、元素反应表、菜品关键词匹配、组队与预算裁剪
- `scripts/artifact.mjs` —— 券归一化、作用域判定、DFS 剪枝组合优化
- `scripts/render.mjs` —— 中日韩字符宽度自算 + 真彩色终端渲染
- `scripts/oracle.mjs` —— 10 个子命令的 CLI 调度

### 第 4 轮：发现并修复一个会导致"虚假省钱结论"的 bug

**WorkBuddy 在自测中发现**：首次跑通全链路后，输出显示
`原始账单 ¥59.50 → 最优 ¥28.75，省 ¥31.75`。

**根因**：券作用域判定把「咖啡类5折」（无门槛、无商品码、只有折扣率）
误判成了**整单折扣券**，于是给整单打了 5 折。

**为什么严重**：判错的代价两个方向不对称 ——
把整单券当单品券只是少算优惠（结论偏保守，安全）；
把品类券当整单券会让估算翻倍虚高（给出**下不了单的虚假结论**）。

**修复**：
1. 新增 `uncertain` 标记：无门槛 + 无商品码 + 只有折扣率的券不参与本地估价
2. 把这批券改由**官方 `calculate-price` 反向探测** ——
   逐行挂上去问官方到底能不能打折，把接口的不透明性当成可实验解决的问题
3. 真实核价结果与本地估算**不混排**，避免用户分不清哪个数字能信
4. 补回归测试锁住该判定（`selftest.mjs` 的「券作用域判定（回归）」分组）

修复后同一输入输出 `¥44.50，省 ¥15.00`，且标注为「本地估算 · 优惠上限」。

### 第 5 轮：验证与文档

**WorkBuddy 产出**：
- `scripts/selftest.mjs` —— 34 项断言，含**优化器 vs 暴力枚举**的 300 组交叉验证
- `references/coupon-optimization.md` —— 把上面这个坑完整写下来，含判错代价对比表
- `references/elemental-table.md` —— 元素映射对照表与扩展指引
- `MCP_INTEGRATION.md` / `README.md` / `mcp-config.example.json` / `LICENSE` / `.gitignore`
- 全子命令冒烟测试：13 条命令路径（含错误分支）逐个验证退出码与输出

## 三、WorkBuddy 在本项目中的具体作用

| 环节 | WorkBuddy 的贡献 |
|---|---|
| 规则解析 | 通读三份官方文档，发现必备文件清单的口径差异并按严者执行 |
| 环境勘察 | 确认连接器未绑定状态，据此设计"离线可验收"的架构 |
| 创意落地 | 把主题映射到真实 MCP 能力，形成可解释的「七元素 ↔ 口味」规则表 |
| 编码实现 | 7 个源码模块，零依赖，约 1800 行 |
| **发现缺陷** | **主动复算输出金额，发现"省 ¥31.75"不合理，定位并修复作用域判定 bug** |
| 测试 | 编写含暴力枚举交叉验证的自测套件（34 项） |
| 文档 | 7 份文档，含踩坑复盘与设计依据 |

## 四、如何复现

```bash
# 1. 零依赖跑通离线全链路
node scripts/oracle.mjs demo

# 2. 跑自测
node scripts/selftest.mjs          # 预期：通过 34 项，失败 0 项

# 3. 接入真实 MCP（需自备 Token）
export MCD_MCP_TOKEN="<你的 Token>"
node scripts/oracle.mjs doctor
node scripts/oracle.mjs party --team 火,冰
node scripts/oracle.mjs artifact --team 火,冰
```

在 WorkBuddy 中：启用 `mcd-mcp` 连接器 + 安装本仓库为 Skill 后，
直接用自然语言对话即可触发上述能力。

## 五、说明

- 本项目所有代码、文档均由 WorkBuddy 在本对话中生成，随后经过实际运行验证
- 文中提到的 bug 是**真实发生并真实修复**的，不是事后编造的叙事
- `--demo` 模式的数据为本地虚构示例，与麦当劳官方实时信息无关
