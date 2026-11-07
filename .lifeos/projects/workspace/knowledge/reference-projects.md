# 参考项目索引（所有 Agent 共用）

> 角色：知识　类型：索引　状态：**现行（2026-11-07 建立，Task 0015 · P4）**
>
> 这份文件回答一件事：**要参考某个项目时，去哪个目录、看哪个 commit、它的定位是什么。**
> 所有 Agent 共用、共维护。没有写进这里的项目，不得作为"参考基线"引用（`projects/lifeos/knowledge/reference-baseline.md` §4 的规则）。

## 怎么用（读之前先看这三条）

1. **唯一根目录 = `~/Code/reference/`**。要参考同类产品，先看这里有没有；没有再按下面的"新增参考"流程拉。
2. **版本以本文件的 commit 为准**，不看"目录当前检出"——因为检出可能被别的任务改过。
3. **引用时写成 `名字 @ commit`**（例：`pi-web @ f130910`），不写裸路径；路径会变，commit 不会。

## 新增 / 更新参考项目（每个 Agent 都按这个做）

```bash
# 1) 拉进唯一根（目录名 = 小写、连字符，与上游 repo 名一致）
cd ~/Code/reference && git clone <repo-url> <name>

# 2) 记下四项事实
git -C ~/Code/reference/<name> remote get-url origin
git -C ~/Code/reference/<name> rev-parse --abbrev-ref HEAD   # 分支
git -C ~/Code/reference/<name> rev-parse --short=7 HEAD      # commit
git -C ~/Code/reference/<name> log -1 --format=%cs           # 日期

# 3) 在本文件加一行（七字段），并在 reference-baseline.md 的对应场景行引用它
# 4) 只读：不把参考代码复制进 Life OS；更新前先 git status，不覆盖本地改动
```

**例外必须写明原因**（见下面"例外"节）：不在这根目录下的项目，一律在这里登记路径与原因。

## 主力参考（A 级：读源码，逐文件逐行对照）

| 名字 | 本地路径 | repo | 分支 | commit | 日期 | 用在哪 |
|---|---|---|---|---|---|---|
| **pi-web** | `~/Code/pi-web`（例外，见下） | `later-3/pi-web`（fork of `agegr/pi-web`） | `codex/later-custom`（上游 = `upstream/main`） | `f3a5c91`（上游 `f130910`） | 2026-08-28（上游 2026-11-04） | 一切会话 UI/协议对照的"镜子"：排队区、未读/运行点、图片、过程区展开、阶段文案 |
| **pi（SDK/TUI）** | `lifeos/pi`（submodule） | `earendil-works/pi` | `main`（2026-11-07 起） | 见 `git -C pi rev-parse --short=7 HEAD` | 随升级 | 运行时底座：事件名、SDK 接口、TUI 的回复展示（`modes/interactive/components/`） |
| **open-design** | `~/Code/reference/open-design` | `nexu-io/open-design` | `main` | `034c389` | 2026-07-22 | 同形态全栈参考；架构与交互 |
| **deepseek-harness-chat** | `~/Code/deepseek-harness-chat`（例外） | `later-3/deepseek-harness-chat` | `master` | `99f6f02` | 2026-08-17 | 同形态 harness 参考（单会话，无会话列表） |
| **LibreChat** | `~/Code/opc-os/LibreChat`（例外） | `danny-avila/LibreChat` | `main` | `8e5ef1f` | 2026-07-16 | 回合生命周期 / steer 权威语义 / composer 版式 |

## 同类产品（A/B 级）

| 名字 | 路径 | repo | 分支 | commit | 日期 | 用在哪 |
|---|---|---|---|---|---|---|
| **mattermost** | `~/Code/reference/mattermost` | `mattermost/mattermost` | `master` | `8b2fb37` | 2026-10-27 | 前端架构/规模化；未读是服务端模型；侧栏分组吸顶 |
| **Rocket.Chat** | `~/Code/reference/Rocket.Chat` | `RocketChat/Rocket.Chat` | `develop` | `034260e` | 2026-10-27 | 徽标断言方式（`role=status` + `aria-label`）；房间未读字段 |
| **zulip** | `~/Code/reference/zulip` | `zulip/zulip` | `main` | `3e9bc1e` | 2026-10-27 | C 级：只看决策/文档（单层 overlay、未读必须服务端算、show-more 模态） |
| **open-webui** | `~/Code/reference/open-webui` | `open-webui/open-webui` | `main` | `33c1978` | 2026-10-25 | C 级：日志两面、侧栏可拖 min/max、输入框视觉 |
| **chatwoot** | `~/Code/reference/chatwoot` | `chatwoot/chatwoot` | `develop` | `2a1dd48` | 2026-07-23 | 已移出基线（Vue+JS/Rails，形态差异大）；仅作 UI 观察 |
| **livecodes** | `~/Code/reference/livecodes` | `live-codes/livecodes` | `develop` | `cd22738` | 2026-07-18 | 已移出基线（无独立后端） |
| **ai-chatbot** | `~/Code/reference/ai-chatbot` | `vercel/ai-chatbot` | `main` | `c2f8235` | 2026-07-08 | 单点：composer 版式、动作条容器/原子分层；官方示例非生产 |

## 素材 / 组件 / 专项（按需，多数未纳入基线）

| 名字 | 路径 | repo | 分支 | commit | 日期 | 备注 |
|---|---|---|---|---|---|---|
| **radix-primitives** | `~/Code/reference/radix-primitives` | `radix-ui/primitives` | `main` | `3a6714c` | 2026-07-22 | a11y 原语参考 |
| **dicebear** | `~/Code/reference/dicebear` | `dicebear/dicebear` | `10.x` | `550f603` | 2026-07-22 | 头像生成（我们已有 agent-avatar，仅备查） |
| **dyad** | `~/Code/reference/dyad` | `dyad-sh/dyad` | `main` | `fc49db5` | 2026-07-22 | 本地 AI app 的 UI/流程观察 |
| **opensandbox** | `~/Code/reference/opensandbox` | `opensandbox-group/OpenSandbox` | `main` | `b4011b3` | 2026-07-22 | 沙箱执行（未纳入） |
| **sandbox-runtime** | `~/Code/reference/sandbox-runtime` | `anthropic-experimental/sandbox-runtime` | `main` | `aa9f6f3` | 2026-07-22 | 沙箱执行（未纳入） |
| **pipecat** | `~/Code/reference/pipecat` | `pipecat-ai/pipecat` | `main` | `cc740d7` | 2026-07-23 | 语音管线（未纳入） |
| **rive-wasm** | `~/Code/reference/rive-wasm` | `rive-app/rive-wasm` | `master` | `353e667` | 2026-07-24 | 动画（未纳入） |
| **sherpa-onnx** | `~/Code/reference/sherpa-onnx` | `k2-fsa/sherpa-onnx` | `master` | `a6ebe74` | 2026-07-23 | 语音识别（未纳入） |
| **BMAD-METHOD-v4.44.3** | `~/Code/reference/BMAD-METHOD-v4.44.3` | `bmad-code-org/BMAD-METHOD` | （detached `HEAD`） | `4c4f6dc` | 2025-10-29 | Agent 方法论（未纳入） |
| **danielmiessler-LifeOS** | `~/Code/reference/danielmiessler-LifeOS` | `danielmiessler/LifeOS` | `main` | `d1d6240` | 2026-07-23 | 同名产品，方法论参考（未纳入） |
| **hermes-agent** | `~/Code/reference/hermes-agent` | `NousResearch/hermes-agent` | `main` | `af250d8` | 2026-07-13 | Agent 会话生命周期；**被 `pi-agent/0015/knowledge/reference-agent-conversations.md:19` 点名引用** |
| **nanoclaw** | `~/Code/reference/nanoclaw` | `nanocoai/nanoclaw` | （detached `HEAD`） | `0c0f4c2` | 2026-07-09 | Agent 沙箱（未纳入） |
| **OpenOPC** | `~/Code/reference/OpenOPC` | `HKUDS/OpenOPC` | `main` | `4bc18dc` | 2026-07-13 | Agent 框架（未纳入） |
| **QwenPaw** | `~/Code/reference/QwenPaw` | `agentscope-ai/QwenPaw` | `main` | `2134427` | 2026-07-13 | Agent 框架（未纳入） |
| **surfsense** | `~/Code/reference/surfsense` | `MODSetter/SurfSense` | `main` | `1ae927a` | 2026-07-08 | 研究型 Agent UI（未纳入） |
| **workflow-examples** | `~/Code/reference/workflow-examples` | `vercel/workflow-examples` | `main` | `96a2b53` | 2026-06-09 | 工作流示例（未纳入） |
| **zeroclaw** | `~/Code/reference/zeroclaw` | `zeroclaw-labs/zeroclaw` | `master` | `42fa197` | 2026-07-12 | Agent 框架（未纳入） |

## 例外（不在这根目录下，原因写在这里）

| 名字 | 路径 | 为什么不在唯一根 |
|---|---|---|
| **pi-web** | `~/Code/pi-web` | **双身份**：它同时是 Later 的设备运维仓库，`~/Code/AGENTS.md:16,18,21` 与 `later-device` / `blocking` 脚本按**绝对路径**引用它（`scripts/device-access.sh`、`ops/device-inventory.json`、`docs/device-onboarding.zh-CN.md`）。搬动会打断跨仓库的硬编码引用，收益只是目录整齐。 |
| **pi（SDK）** | `<lifeos 仓库>/pi` | 它是 Life OS 的 git submodule（固定 commit = 运行时事实）。**不是**"最新上游"；要看最新上游时按 §"新增/更新"另拉一份到唯一根，不要就地改 submodule。 |
| **LibreChat** | `~/Code/opc-os/LibreChat` | 属于另一个工作区（`opc-os`）的检出，被那边的任务使用；移走会打断它。 |
| **deepseek-harness-chat** | `~/Code/deepseek-harness-chat` | 是我们自己的 fork（`later-3/`），在 `~/Code` 顶层被多个任务直接引用；留在原地避免改动那些引用。 |

## 维护规则

- **新增一行** = clone 到唯一根 + 补齐七字段 + 在 `reference-baseline.md` 补/改对应场景行；
- **更新 commit** = 只改本行四个版本字段 + 在 `reference-baseline.md` 里凡是写死旧 commit 的地方一起改（`grep -rn "<旧 commit>"`）；
- **删除** = 只有在 `reference-baseline.md` 与所有任务的 `knowledge/` 都不再引用时才能删；删前 `grep` 确认；
- **不看"当前检出"**：本文件是唯一版本记录。目录被别的任务改成别的分支时，以本文件为准去 `git checkout <commit>`。
