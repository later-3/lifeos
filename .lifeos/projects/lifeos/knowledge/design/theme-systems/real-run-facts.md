# 四家真实运行与实测（2026-11-09）

> 目的：把「对标项目长什么样、代码怎么实现」变成**可复核的事实**，之后不再反复启动它们。
> 结果沉淀在本目录，截图在 `evidence/refs-real/`，可复现的工程在 §4。

## 1 结论先写：哪些真跑起来了

| 参考 | 跑法 | 状态 | 证据 |
|---|---|---|---|
| **LobeHub 2.3.2** | 官方 **GitHub Release 桌面版**（arm64 mac，168MB），`--remote-debugging-port=9333` + Playwright CDP | ✅ **真跑起来了**（官方发布包，非自编译） | `refs-real/lobehub-light.png` / `-dark.png` |
| **LobeHub UI 库** | npm `@lobehub/ui@6.15.2` + Vite 最小页 | ✅ 真组件渲染 | `refs-real/lobehub-ui-components.png` |
| **LibreChat** | npm `@librechat/client@0.4.85` 真组件 + 它自己的 `tokens.css`/`tailwind-preset`，按它的源码结构搭一屏 | ⚠️ **组件是真的、版式是我搭的**（不是它的控制台） | `refs-real/librechat-light.png` / `-dark.png` / `-components.png` |
| **novu Inbox** | 官方 **Inbox Playground**（`inbox.novu.co`，免登录可交互，可切 Default/Notion/Reddit 三套主题） | ✅ 真跑起来了 | `refs-real/novu-inbox-playground.png` / `novu-notion-theme.png` |
| 我们 | dev 5192 | ✅ | `refs-real/ours-light.png` / `-dark.png` |

**跑不起来的**（已放弃，理由见 `evidence/refs/README-run-attempts.md`）：三家主仓都要 Mongo/Redis/Docker，
本机 Docker daemon 起不来（`open -a Docker` 后 10 分钟未就绪），也没有任何数据库。
**不需要再试了** —— 桌面版 + 发布包组件 + 官方 playground 已经给出了全部事实。

## 2 实测数值（浏览器读 computed style / 读发布包 CSS，不是估算）

### 2.1 侧栏选中强度

| | 列底 | 选中 | **ΔL\*** | 来源 |
|---|---|---|---|---|
| LobeHub light | `#fcfcfc` | `#ededed` | **5.3** | `fillSecondary` .06 叠 layout |
| LobeHub light hover | | `#f4f4f4` | 2.8 | `fillTertiary` .03 |
| LobeHub dark | `#0d0d0d` | `#252525` | **11.1** | 白 .10 叠 container |
| LibreChat light（Click UI 主题） | `#ffffff` | `#e6e7e9` | **8.4** | `clickui.json` `sidebar.main.navigation.item.color.background.active` |
| LibreChat light（默认主题） | `#f7f7f8` | `#e3e3e3` | 7.1 | `surface-active-alt` = gray-200 |
| LibreChat dark（Click UI 主题） | `#1f1f1c` | `#333332` | **9.5** | `clickui.json` 同名键 |
| LibreChat dark（默认主题） | `#212121` | `#2f2f2f` | 6.7 | `surface-active-alt` = gray-700 |
| novu light | `#fafafa` | alpha .10 | 3.3 | `index.css` gray-alpha-24 |
| **我们 light** | `#f7f6f5` | `#e1dddd` | **8.5** | `--color-nav-selected` |
| **我们 dark** | `#232222` | `#474544` | **16.1** | 同上 |

### 2.2 ⚠️ 一处必须修正的旧结论

旧文档写「LibreChat 深色选中 `#414141` → ΔL\* **15.9**」，并据此把我们的深色定在 16.1。
**实测这是错的**：`#414141` 是 `rgb-surface-active`（palette.neutral.700），**不是** `surface-nav-selected`。

`clickui.json` 的真实键值：

```json
"light": { "click.sidebar.main.color.background.default": "#ffffff",
           "click.sidebar.main.navigation.item.color.background.active": "#e6e7e9",
           "click.sidebar.main.navigation.item.color.background.hover": "lch(91.609 1.1023 265.86 / 0.6)" },
"dark":  { "click.sidebar.main.color.background.default": "#1f1f1c",
           "click.sidebar.main.navigation.item.color.background.active": "lch(27.535 0 none / 0.6)",
           "click.sidebar.main.navigation.item.color.background.hover": "lch(19.05 0 none)" }
```

→ 深色选中真实是 **9.5**，不是 15.9。**两家深色区间 9.5–11.1，我们 16.1 明显偏高。**

已据此修正的地方：`theme.ts` 注释、`test/theme.test.mjs` 注释与区间、`comparison.md` §2/§3.2、`our-benchmark.md`。
**数值是否下调需要用户裁决**（见 §5）——用户此前明确要求「深色高亮必须明显」，
16.1 是照这条要求调的，不是照 LibreChat 调的。

### 2.3 其他实测（同一台机器、同一浏览器）

| 量 | LobeHub（桌面版） | LibreChat（真组件） | novu（playground） | 我们 |
|---|---|---|---|---|
| 行高 | 36px（列表项 26px） | 36px | 通知行 147.6px（三行内容） | 36px |
| 圆角 | 8px（按钮 6px） | 8px（`rounded-lg`），头像 full | 7.998px（`rounded-lg`） | 8px |
| 正文字号 | 14px | 14px | — | 13px |
| 字重 | 400（选中不换字重） | 500（`font-theme-control`） | — | 500 |
| 主按钮 | `#222222` 底 / 深色 `#222` | `#171717` 底（`bg-button-primary`） | — | 品牌主色 |
| 页面底色 | `#f8f8f8`（layout）/ `#fff`（container） | `#fff`（primary）/ `#f7f7f8`（secondary） | panel `oklch(0.991 …)` | `#f7f6f5`（nav）/ `#ffffff`（surface） |
| 深色底色 | `#000` layout / `#0d0d0d` container / `#202020` border | `#212121` primary / `#0d0d0d` gray-900 | 无 | `#232222` nav / `#292828` surface |

**LobeHub 一个重要实现细节（读桌面版 DOM 得到）**：
选中态**不改字重、不改文字色**，只靠 `rgba(0,0,0,.06)` 的一层填充；hover 是 `.03`。
所以它的"选中 vs hover"只差 2 倍左右（5.3 / 2.8 = 1.89）——我们取 2.0，同一档。

## 3 源码对应关系（页面效果 ↔ 代码）

| 看到的效果 | 对应代码 |
|---|---|
| LobeHub 选中/悬停填充 | `src/color/colors/gray.ts` 收窄为 alpha 双份；组件用 `fillSecondary`/`fillTertiary` |
| LobeHub 页面/卡片两层底色 | `--lobe-color-bg-layout` / `--lobe-color-bg-container`（`theme.css`） |
| LobeHub 深色分层 | layout `#000` → container `#0d0d0d` → elevated `#1a1a1a`（越上越亮） |
| LibreChat 选中/悬停 | `packages/client/src/theme/themes/clickhouse.ts:129`（`rgb-surface-nav-selected`）、`:128`（hover） |
| LibreChat 深色两套 | 同名文件 `:263`（`surface-active` = `#414141`）、`:326-327`（nav-hover / nav-selected） |
| LibreChat 圆角/字重 | `clickui.json` `border.radii.2`=0.5rem、`click.button.basic.typography.label.default` = `400 0.875rem/1.5 Inter` |
| LibreChat 运行时换色 | `theme.css` 的 `@theme inline` + `defaults.css` 的 `R G B` 三元组（不是重生成 CSS） |
| novu 三套主题可切 | `inbox.novu.co` 的 `Default Theme / Notion / Reddit` tab（同一组件、不同 CSS 变量集） |
| novu 圆角 | `nt-rounded-lg` = 7.998px（Tailwind 0.5rem） |

## 4 可复现

| 工程 | 位置 | 启动 |
|---|---|---|
| LobeHub 桌面版 | `/tmp/lobedesktop/LobeHub.app`（官方 Release v2.3.2） | `--remote-debugging-port=9333`，Playwright `connectOverCDP` |
| LobeHub UI 组件页 | `/tmp/refui`（`@lobehub/ui@6.15.2` + vite） | `npx vite`，端口 5293 |
| LibreChat 组件页 | `/tmp/refui2`（`@librechat/client@0.4.85` + tailwind v4 + vite） | `npx vite`，端口 5294 |
| 四联 token 对照页 | `evidence/demo/compare/sidebar-compare.html` | 端口 5290 |

**LibreChat 组件页踩过的坑（都是它的真实结构约束，值得记）**：
1. `@librechat/client` 有 **53 个 peer dep**，`--legacy-peer-deps` 是必须的；
2. 它用 **Tailwind v4**（`^4.3.3`），`@theme inline` 才会展开 `bg-surface-*` 这类 token 类；
   v3 能编但**一个 token 类都生成不出来**（页面看起来"全裸"）；
3. `@dicebear/core` 必须 `9.4.x`（`^9.4.3`），装成 10.x 会在 `escape` 导入上崩；
4. `@tanstack/react-table` 必须 `8.x`（装成 9.x 缺 `getCoreRowModel`）；
5. `AnimatedTabs` 是**一个组件吃 `tabs` 数组**，没有 `AnimatedTabsList/Trigger` 子组件。

## 5 需要用户裁决的一条

**决策点**：深色侧栏选中强度是否从 16.1 下调？

| 选项 | 优势 | 代价 |
|---|---|---|
| **A 维持 16.1** | 满足你「深色必须明显」的要求；与浅色 8.5 形成明确深浅梯度 | 比两家实测（9.5 / 11.1）高一档，视觉上"重" |
| **B 降到 11.5**（LobeHub 11.1 的上沿） | 与产品参考一致，深色不那么"糊" | 可能回到你觉得"不够明显"的观感 |
| C 折中 13 | 介于两者之间 | 无直接参考值支撑，属于凭直觉 |

**推荐 A 维持**：依据是你 2026-11-09 的实际反馈（深色几乎看不见），且"选中≈hover×2"的比例
在 A 下仍成立（8.1 / 16.1）。B 只在对齐参考时更漂亮，没有用户侧证据。
