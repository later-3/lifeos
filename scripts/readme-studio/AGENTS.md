# readme-studio · 拍摄工具箱说明书

> 角色：工具　类型：说明书　状态：现行（2026-11-16 建立，2026-11-17 补流程索引）

## 背景与目的

README 的图与产品宣传片不是一次手工活——每次改版都要重拍。手工截图换台机器就重现不出来，
所以把「录制 → 编码 → 审核材料」做成可重跑的工具。

## 里面有什么（三份文档分工，别找错）

| 文档 | 回答什么 |
|---|---|
| **`MAINTAINING.md`** | **维护 README 的流程**：四类改动怎么走、改图七步、门禁、什么算改完、**5 个真实反面案例**、症状→先查什么 |
| **`DIRECTOR.md`** | **一张素材怎么"演"**：R1 操作只演一次 / R2 角标 / R3 焦点放大 / R4 流程固化；镜头表模板；5 类素材类型学；7 条自检 |
| **本文** | 工具箱**怎么跑**、技术坑、什么拍不了 |

| 文件 | 是什么 |
|---|---|
| `cursor.mjs` | 拍摄光标（圆点 + 点击涟漪）。录屏**不含系统光标**，没有它观众看不出点了哪里 |
| `capture.mjs` | 捕获：`recordVideo`（25fps→GIF）/ CDP `startScreencast`（实测 1080p 93fps→60fps 视频）；执行动作；每步抓关键帧；断外网 |
| `encode.mjs` | GIF / MP4 / WebP；空白帧检测；体积断言与预警 |
| `run.mjs` | CLI：读 YAML storyboard → 录制（单镜头或多镜头）→ 编码 → 输出审核材料 |
| `stub-model.mjs` | OpenAI 兼容的**打桩模型服务**（SSE 流式），拍摄专用 |
| `storyboards/*.yml` | 每张素材一份动作脚本（人可读、可审、可单独重跑） |

## 怎么跑（最短路径）

```bash
# 0 三件套（缺一不可，细节见 MAINTAINING.md §2）
LIFEOS_HOME=~/.lifeos-showcase node --experimental-strip-types src/main.ts --port=<N>
VITE_DEV_API=http://127.0.0.1:<N> pnpm --dir frontend exec vite --port <M>
node scripts/readme-studio/stub-model.mjs          # 打桩，默认 127.0.0.1:43140

# 1 拍
STUDIO_APP=http://127.0.0.1:<M> node scripts/readme-studio/run.mjs hero
STUDIO_APP=... node scripts/readme-studio/run.mjs --all

# 2 看审核材料
ls /tmp/lifeos-studio/<name>/keys/    # 每步一张 PNG
cat /tmp/lifeos-studio/<name>/summary.json   # 时长 / 帧数 / 体积
```

产物：成片 → `docs/images/<file>`；原始录制 → `/tmp/lifeos-studio/<name>/video/`（**保留**，重编码不必重拍）。

## storyboard 写法

```yaml
name: hero
mode: video                      # video（recordVideo）| cdp（screencast，宣传片用）
viewport: { width: 1000, height: 625 }
size: { width: 1000, height: 625 }
path: /
outputs:
  - { type: gif, file: hero.gif, fps: 10, width: 1000, colors: 128 }
steps:
  - waitFor: '[data-testid="groups-panel"]'
  - pause: 1.0
  - click: 'text=Architect'
  - type: { into: '[data-testid="composer"]', text: "…", delayMs: 32 }
  - press: Enter
```

动作全集：`click` `type` `press` `move` `scroll` `zoom` `unzoom` `waitFor` `waitForText` `pause`
`shot` `eval` `evalFile` `badge` `scene` `selectText`。

**多镜头**（`scenes:` 代替 `steps:`）：每个 scene 独立开 context 录一段，可各自带 `prelude`（注入 localStorage 再重载）
与 `badge`（画面内角标），最后拼接。

## 技术坑（每条都有实测依据，别再摸一遍）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| **历史会话不能续跑新一轮** | Pi 校验报 `number 6 is not iterable` | 演示家目录的会话是脚本直写 JSONL 的，只能看不能续；要拍"发消息"必须**新建会话** |
| **真模型会污染画面** | 出现红色"模型调用失败" | 用 `stub-model.mjs`；且要改 `models.json` 里**所有 provider** 的 baseUrl（优先级：Agent 个人 → 系统 → 清单）。见 `MAINTAINING.md` C219 |
| **录屏开头白屏** | 前 1–2 秒全白 | `findContentStart()` 自动跳过（解码帧统计颜色种类，白屏 1–3 种 vs 真实界面 300+） |
| **展示型镜头取错区间** | 拼接后整段白帧 | `trimEnd` 取**末尾** N 秒，不是开头。见 C220 |
| **`xfade` 三段以上拼接** | 产出整段白帧 | 两段可行、三段不行；预转恒定帧率 mp4 再 xfade 也报 `rate 1/0`。改用**每段首尾淡到黑 + concat** |
| **GIF 体积压不下去** | 文字满屏 ≈300KB/秒 | 别硬压：8fps/900/64 色只有 2.2MB 但字糊。可读性优先，守 GitHub 10MB |
| **特写后期放大** | `crop+scale` 出来糊 | 特写必须**录制时**做（`element.style.zoom`）或 2x 录制后裁切缩小 |
| **中文字幕出方块** | `PingFang.ttc` / 不指定 fontfile 都失败 | 必须 `fontfile='/System/Library/Fonts/Hiragino Sans GB.ttc'` |
| **本机 ffprobe 是 wrapper** | 无视 `-of csv`，永远吐 JSON | 必须 `-print_format json` 再解析 `.format.duration` |
| **路径含中文时 CLI 判定失效** | `import.meta.url` 被 percent-encode | `isMain()` 用 `fileURLToPath` + `realpath` |
| **演示家目录不是 git 仓** | 检视面板永远"没有可检视的改动" | `git init` + 提交基线 + **每次重造**未提交改动（不能"已存在就跳过"） |
| **只给一个 Agent 造改动** | 换个 Agent 的会话点检视 → 0 个文件 | **每个 Agent 都造** |
| **拍摄光标缺失** | 观众看不出点了哪里 | `cursor.mjs`（手法参考 shot-scraper @63104b0，只借 DOM 做法不引依赖） |

## 什么拍不了（先说清，别硬凑）

| 想拍的 | 为什么不行 | 替代 |
|---|---|---|
| Task 工作区（worktree） | 演示家目录里的 Task 没有真 `repo/`，检视面板显示"这个 Task 还没有代码工作区" | 用 `05-task-header`（会话上的 Task 编号）+ 文字说明 |
| 「派活 → 回流」全过程 | 打桩模型触发不了 `lifeos_ask` 工具链 | 拍真实的 Agent↔Agent 会话；文案只写"Agent 之间也有对话" |
| 真实 PWA 安装提示 | headless Chromium 的 `beforeinstallprompt` 需要真实安装条件 | 拍手机竖屏 + 文字说明；不假装有安装流程 |
| 60fps GIF | 无必要，体积翻 3 倍 | 视频才用 60fps（产线 B） |

## 拍摄纪律（必须）

- **必须**用演示家目录（路径含 `readme` 或 `showcase`）；**不得**用真实家目录直接拍。
- **必须**断外网（`capture.mjs` 默认拦掉非本机请求）。
- **必须**每次从同一份演示数据开始（`run.mjs` 拍摄前重跑 `readme-demo-home.mjs`）。
- **必须**给用户审核材料：关键帧 + 时长 + 体积，而不是"我拍好了你看吧"。
- **应该**一个 storyboard 只演一个动作序列。

## 相关

- 维护流程与反面案例：`MAINTAINING.md`（同目录）
- 素材演法：`DIRECTOR.md`（同目录）
- 演示数据：`scripts/readme-demo-home.mjs`（造）与 `~/.lifeos-showcase`（真实家目录副本，已清凭据与测试残留）
- 宣传片（产线 B）：Task 0023 的 `02-plan.md`
