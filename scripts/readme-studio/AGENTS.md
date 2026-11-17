# readme-studio · 拍摄工具箱说明书

> 角色：工具　类型：说明书　状态：现行（2026-11-16，Task 0022 建立）
>
> 这份文件回答：**要拍一张产品素材时，用哪个脚本、怎么写 storyboard、踩过什么坑、什么拍不了。**

## 背景与目的

README 的配图与产品宣传片不是一次性手工活——每次改版都要重拍。手工截图的代价是「换个机器就重现不出来」，
所以这里把「录制 → 编码 → 审核材料」做成可重跑的工具，而不是一堆散落的 Playwright 脚本。

它同时服务两条产线（Task 0022 与 0023 共用，见 0022 的 D15）：

| 产线 | 输出 | 捕获方式 | 为什么 |
|---|---|---|---|
| README 素材 | GIF / WebP | `recordVideo`（25fps） | GIF 只出 10–12fps，25fps 源够用，且一步出 webm、链路最短 |
| 产品宣传片 | MP4 60fps | CDP `Page.startScreencast`（实测 1080p **93fps**） | `recordVideo` **固定 25fps**（实测 `r_frame_rate=25/1`），做不出 60fps 顺滑镜头 |

## 里面有什么

| 文件 | 是什么 |
|---|---|
| `cursor.mjs` | 拍摄光标（圆点 + 点击涟漪）。录屏**不含系统光标**，没有它观众看不出点了哪里 |
| `capture.mjs` | 两档捕获；执行 storyboard 动作；每步抓关键帧；断外网 |
| `encode.mjs` | GIF / MP4 / WebP；空白帧检测；体积断言与预警 |
| `run.mjs` | CLI：读 YAML storyboard → 录制 → 编码 → 输出审核材料 |
| `stub-model.mjs` | OpenAI 兼容的**打桩模型服务**（SSE 流式），拍摄专用 |
| `storyboards/*.yml` | 每张素材一份动作脚本（人可读、可审、可单独重跑） |

## 怎么用

```bash
# 1. 起演示实例（不是主实例！主实例是用户的）
LIFEOS_HOME=~/.lifeos-readme node --experimental-strip-types src/main.ts --port=<分配到的端口>
# 2. 起打桩模型（画面里不能出现"模型调用失败"）
node scripts/readme-studio/stub-model.mjs                    # 默认 127.0.0.1:43140
# 3. 起前端（指向演示后端）
VITE_DEV_API=http://127.0.0.1:<端口> pnpm --dir frontend exec vite --port <分配到的端口>

# 4. 拍
STUDIO_APP=http://127.0.0.1:<前端端口> node scripts/readme-studio/run.mjs hero
STUDIO_APP=... node scripts/readme-studio/run.mjs --all       # 全部
```

产物：
- 成片 → `docs/images/<file>`（按 storyboard 的 `outputs`）
- 审核材料 → `/tmp/lifeos-studio/<name>/keys/*.png`（每步一张）+ `summary.json`（时长 / 帧数 / 体积）
- 原始录制 → `/tmp/lifeos-studio/<name>/video/*.webm`（**保留**，重编码不必重拍）

## 写一份 storyboard

```yaml
name: hero                       # 产物目录名，也是默认输出前缀
mode: video                      # video（recordVideo）| cdp（screencast，宣传片用）
viewport: { width: 1000, height: 625 }   # CSS 视口
size: { width: 1000, height: 625 }       # 录屏尺寸（mode=video 时）
path: /                          # 相对 STUDIO_APP 的路径
outputs:
  - { type: gif, file: hero.gif, fps: 10, width: 1000, colors: 128 }
steps:
  - waitFor: '[data-testid="groups-panel"]'
  - pause: 1.0
  - click: 'text=Architect'
  - type: { into: '[data-testid="composer"]', text: "…", delayMs: 32 }
  - press: Enter
```

动作全集（`capture.mjs` 的 `ACTIONS`）：`click` `type` `press` `move` `scroll` `zoom` `unzoom` `waitFor`
`waitForText` `pause` `shot` `eval`。

**两种写法都支持**（语义相同，`paramsOf` 抹平）：
```yaml
- type: { into: '…', text: '…' }     # 单行映射
- type:                              # 分行块（参数多时可读）
    into: '…'
    text: '…'
```

## 踩过的坑（每条都有实测依据，别再摸一遍）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **历史会话不能续跑新一轮** | Pi 校验报 `number 6 is not iterable` | 演示家目录的会话是脚本直写 JSONL 的，只能**看**不能续；要拍"发消息"必须**新建会话** |
| **真模型会污染画面** | 画面里出现红色"模型调用失败" | 用 `stub-model.mjs`；真模型还会导致每次内容不同、不可复现 |
| **录屏开头白屏** | 前 1–2 秒全白（`context` 创建即开录） | `encode.mjs` 的 `findContentStart()` 自动跳过：解码帧统计颜色种类，白屏 1–3 种、真实界面 300+ |
| **GIF 体积压不下去** | 文字满屏 ≈ 300KB/秒 | 别硬压：8fps/900/64色 只有 2.24MB 但字明显糊。**可读性优先**，守住 GitHub 10MB 硬线即可 |
| **`mpdecimate` 去重帧** | 只省 3%，还让时间轴抖 | 不用 |
| **特写靠后期放大** | `crop+scale` 出来是糊的 | 特写必须在**录制时**用 `element.style.zoom`（Chromium 原生属性，字体重新排版，清晰） |
| **中文字幕出方块** | `PingFang.ttc` 或不指定 fontfile 都失败 | 必须 `fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc'` |
| **xfade 拼接报错** | `parameters do not match`（差 1px 就挂） | 拼接前统一 `scale` + `setsar=1` |
| **本机 ffprobe 是 wrapper** | 无视 `-of csv`，永远吐 JSON → `Number()` 得 NaN | 必须 `-print_format json` 再解析 `.format.duration` |
| **路径含中文时 CLI 判定失效** | `import.meta.url` 被 percent-encode，`argv[1]` 没有 | `isMain()` 用 `fileURLToPath` + `realpathSync` 两边比 |
| **演示家目录不是 git 仓** | 检视面板永远"没有可检视的改动" | `readme-demo-home.mjs` 里 `git init` + 提交基线 + **每次重造**未提交改动（不能"已存在就跳过"） |
| **只给一个 Agent 造改动** | 换个 Agent 的会话点检视 → 0 个文件 | **每个 Agent 都造**（检视请求带的是该会话所属 Agent 的 taskDir） |
| **拍摄光标缺失** | 观众看不出点了哪里 | `cursor.mjs` 注入（手法参考 shot-scraper @63104b0，Apache-2.0，只借 DOM 做法不引依赖） |

## 什么拍不了（先说清，别硬凑）

| 想拍的 | 为什么不行 | 替代 |
|---|---|---|
| `task-worktree`（Task 工作区） | 演示家目录里的 Task 没有真 worktree（`repo/` 不存在），检视面板显示"这个 Task 还没有代码工作区" | 拍 `05-task-header.webp`（会话上的 Task 编号）已经够表达；worktree 用文字讲 |
| `peer-delegate` 的完整回流 | 打桩模型不会触发真的 `lifeos_ask` 工具调用链 | 拍**工具卡本身**（演示会话里已有 `lifeos_ask` 记录）；或此图降级为静态图 |
| 真实 PWA 安装提示 | headless Chromium 的 `beforeinstallprompt` 需要真实安装条件 | 拍手机竖屏（`mobile.webp`）+ 文字说明；不假装有安装流程 |
| 60fps GIF | GIF 没有这个必要，体积会翻 3 倍 | 视频才用 60fps（产线 B） |

## 拍摄纪律（必须）

- **必须**用演示家目录（`~/.lifeos-readme`，脚本护栏要求路径含 `readme`）；**不得**用真实家目录。
- **必须**断外网（`capture.mjs` 默认拦掉非本机请求）：既防卡顿，也防数据外泄。
- **必须**每次都从同一份演示数据开始（`run.mjs` 拍摄前自动重跑 `readme-demo-home.mjs`）。
- **必须**给用户审核材料：关键帧 + 时长 + 体积，而不是"我拍好了你看吧"。
- **应该**一个 storyboard 只演一个动作序列，不做大杂烩。

## 相关

- 演示数据：`scripts/readme-demo-home.mjs`
- README 文案与 46 条特性的清点：Task 0022 的 `01-background.md`
- 宣传片分镜与产线 B 参数：Task 0023 的 `02-plan.md`
