# resources/ · 参考图素材与读取规则

## 背景与目的

这里是**用户提供的视觉参考图**（布局 / 风格 / 配色），供设计讨论与前端实现时对照用。
它们不是代码、不是产品资源、不是测试夹具；**不进 Git**（本目录 `.gitignore` 忽略全部，仅本文件例外）。

**为什么要有这份说明书**：读图是按像素烧 token 的，而 90% 的场合只需要"这张图大概是什么版式、借了什么"——文字能回答。实测本目录 14 张图 **4,241,434 字节 ≈ 4.04 MB**；按长边 1568 缩放后**全量读一遍 ≈ 33,700 图像 token**（口径：宽×高÷750，见文末对照表）。本文件先把每张图的**内容 / 布局 / 风格 / 可借 / 不可借**写成文字，读图变成最后手段。

> ⚠️ **索引准确性（2026-11-09 复核）**：本表曾与文件实际内容不符 6 处（有 3 张图被替换过但文件名没变）。
> 现在已按**实际读图**逐条核对并修正。**读图结论与本节冲突时，以读图为准，并回来修正本节**。

## 里面有什么

| 文件 | 尺寸 | 字节 | 是什么 |
|---|---|---|---|
| `2c1bccb72a45a569cc01ab74c9d4e8d2.webp` | 3200×2400 | 81 KB | Personal / AI Assistant 财务助手（蓝天背景版） |
| `f8e97d432474a98bbd9e014b65b28fef.webp` | 3200×2400 | 73 KB | 同上，整窗版（含窗口条）——与上一张同族 |
| `original-2bcbab90467c67819195a33fb6b228fb.webp` | 3200×2400 | 96 KB | **"Welcome, David!" 空态三卡**（不是财务助手）——与 Twiks 空态同族 |
| `660b1a18e0a9b40a0a7b24b0bccdf008.webp` | 3810×2717 | 307 KB | Harmonic AI 团队工作台（多 Agent 卡片网格 + 热力表） |
| `original-27f477ccb88bcaa1c868588a70f4e2ed.webp` | 3200×2400 | 175 KB | **看板（Kanban）**：Design for Landing Page，四列 Planned/In Progress/Done/On Hold，卡底叠放头像 + `+7`/`+18` |
| `original-37cc787d7c393228837ed891b4fe1b67.webp` | 3810×2858 | 231 KB | 同上，更大更清——同族 |
| `original-6d52793f1189a0702545d9d0066a28a9.webp` | 3200×2400 | 153 KB | Codomo 看板 v1（任务卡底叠放头像） |
| `original-f576886481d6d7834a8efc8a409001e1.webp` | 3200×2400 | 158 KB | Codomo 看板 v2（头像组 + 数字汇总 "18"） |
| `original-ac790b5b53efe89fe0bf54d6ec375416.webp` | 2400×1800 | 133 KB | **绿底三栏社交 App**：左 Friends 列表（头像+名+副标题+右缘图标）/ 中 Feed 流 / 右详情——**与本项目左栏结构唯一同构的参考** |
| `original-c3d1aaef364bf85ac892b26fd21e9592.webp` | 3810×2858 | 196 KB | Witty.ai 求职信生成（空态） |
| `original-24273b8a6c542108f321ebf4806c5aae.webp` | 3810×2858 | 278 KB | 同上，已生成态（右栏有真实内容） |
| `469d61c0e6a14f99da269b437c2c08b2.webp` | 3810×2858 | 381 KB | **手机旅行 App 3 屏**（中间屏是 Obertauern Ski Resort 营地卡） |
| `original-bcfa8fe502fef5963c379cc64acafe49.webp` | 3810×2858 | 116 KB | **手机旅行「Where do you want to go」**：搜索胶囊 + 图上信息标签 + 路线卡 |
| `original-927c58b7cfa659e131e5d314c3a41c08.webp` | 1170×728 | 39 KB | **Instagram 模板卡三联**：黄底、图上大字排版、卡底 ❤️💬✈ 动作行 |
| `original-997da9d082f8273f315732f1681ab690.webp` | 3200×2400 | 274 KB | **Simstagram 手机三联**：story 环头像 / 帖子卡（大头图+动作行+标签）/ 九宫格探索 |
| `original-95c19cf8b520874429f3f1cc32967a2b.webp` | 3200×2400 | 274 KB | 粉色社交 AI（双手机模型：生成器 + 群聊） |
| `Snipaste_2026-11-01_22-01-36.png` | 2864×1880 | 1.08 MB | **GitHub Copilot 会话**（过程折叠的来源） |
| `Snipaste_2026-11-01_22-05-25.png` | 2888×1894 | 0.91 MB | **GitHub Copilot 会话**（参与者评论流 / 动作条） |

## 每张图说了什么（读这一节代替读图）

> 字段固定为**内容 / 布局 / 风格配色 / 可借 / 不可借**。判断结论的正式出处仍是 `knowledge/reference-baseline.md`（本表只做索引，不复制条文）。

### 1. `2c1bccb7…` / `f8e97d43…` / `original-2bcbab…`（Personal · AI Assistant 家族，3 张）

- **内容**：个人财务助手，中间一张 AI 对话卡（"Work with GPT-5.0 & Gemini 2.5" + 输入框 "Ask Lumen AI Assistant…" + 底部一排小工具图标），配 Budget Tracker / Smart Budget / Calculation / Spending 等数据卡。
- **布局**：左 232px 导航（Dashboard / Wallet / Transactions / Report / Cash Flow / **AI Assistant 高亮** / Budget〔带红点〕/ Goals / Investments）＋中间主轴＋右下数据卡；三张是同一界面的不同裁切。
- **风格配色**：蓝天渐变背景浮白卡，蓝色主色（≈ `#2563eb` 系），大圆角（16–20）、轻阴影。
- **可借**：AI 卡的**四段结构**（标题 → 模型副标题 → 输入框 → 工具行）。
- **不可借**：蓝天插画背景、大圆角、数据卡堆叠密度。

### 2. `660b1a18…`（Harmonic AI 团队工作台）

- **内容**：多 Agent 团队视图。上方「Task Volume By Day」成员×星期的数字热力表、右上「Success Rate & Time Trend」双柱图；下方「All agents」6 张卡片。
- **布局**：每张 Agent 卡固定槽位——照片头像 48 / 姓名 / 角色 / `Active` 绿标 / `Task this week` / `Open ticket` / `Success rate 91%` / `Avg Resolution 1.8 Days` / 卡底 `LAST ACTIVITY: Completed Work Order #129`。
- **风格配色**：白底、紫主色、靠阴影分层、信息密度高。
- **可借**：**Agent 卡的信息槽位清单**（谁的/什么角色/在不在忙/最后干了什么）——就是我们"同事"这一层该显示什么。
- **不可借**：照片头像、紫色、满屏卡片边框。

### 3. `original-27f477cc…` / `original-37cc787d…`（Design You 仪表盘，2 张）

- **内容**：项目管理仪表盘。"Ongoing Tasks" 里的橙色高亮卡、`All Projects` 表格、右侧 `Internal Teams` 头像组 + `August 2024` 迷你日历 + `Team Members`（头像+名+邮箱+绿点在线）。
- **布局**：左 200px 侧栏（含 Projects 分组与子项）＋中间统计卡+任务卡+表格＋右 260px 侧栏（团队/日历/任务/成员）。
- **风格配色**：橙 + 紫撞色、圆角 12、白卡。
- **可借**：**"一组参与者"= 叠放头像 + `+N` 计数**（`All Projects` 行与 `Internal Teams` 都是这个做法）。
- **不可借**：橙紫撞色、迷你日历、创始人卡。

### 4. `original-6d52793f…` / `original-f5768864…`（Codomo 看板，2 张）

- **内容**：看板。顶栏 `Index Company > Design for Landing Page` + 参与者头像组（`+7` / `+18`）+ `+ Add assign`；四列 Planned / In Progress / Done / On Hold。
- **布局**：卡片 = 标题 + 灰色描述 + `12 Nov` + 百分比环 + 评论/附件计数 + **底部一排 4 个叠放小头像**；左 216px 项目树。
- **风格配色**：白底、灰描边、极小圆角、蓝→青渐变百分比环。
- **可借**：**任务卡底的叠放头像组**（一行表达"谁在这个活上"）；人多时用数字汇总这个做法。
- **不可借**：看板形态本身。

### 5. `original-ac790b5b…`（Twiks.AI 欢迎页）

- **内容**：AI 产品空态。居中大标题 + 副文案 + 输入框（`Ask Something…` + 黑色圆发送钮）+ 下方三张彩色图标卡（Productivity Boost / User-Friendly Onboarding / Voice-Activated Responses）。
- **布局**：左 180px 侧栏（Explore / Templates / Files / History + Recent Chats）＋居中单列主区（无右栏）。
- **风格配色**：暖白、黄/橙/粉三色图标、大留白。
- **可借**：**空态三卡的"图标 + 标题 + 一句解释"结构**。
- **不可借**：暖色插画卡片、侧栏内容组织。

### 6. `original-c3d1aaef…` / `original-24273b8a…`（Witty.ai 求职信，2 张）

- **内容**：左表单 / 右预览的生成器。第一张是空态（右侧"Answer the prompts"+信封图标），第二张是已生成态（右侧一封完整求职信：姓名/职位/联系方式/日期/抬头/4 段正文/署名）。
- **布局**：左 216px 侧栏（含套餐卡 `Basic Plan 4/10`、试用提示）＋中间 500px 表单（进度、多行内容区带计数、chips、输出比例、两列 From/To 必填）＋右 460px 预览。
- **风格配色**：紫主色、圆角 8、表单密度中等。
- **可借**：**"左表单 / 右预览"双栏**与必填 `*` 的表达；**同一界面的空态 vs 有内容态**可当验收样本。
- **不可借**：紫色、进度条样式、侧栏套餐卡。

### 7. `original-95c19cf8…`（粉色社交 AI）

- **内容**：两台手机模型并排。左：AI 生成社媒帖（标题 + `$300/model` + 5 个 trending chips + 「Ride the trend」两张内容卡 + 底部输入框）；右：`Girls` 群聊（顶部三图拼贴 + 气泡带 24px 圆头像 + 中间夹一张 `Trip Prep Checklist` 系统卡）。
- **布局**：纯移动端两屏对照。
- **风格配色**：粉紫渐变、圆角 20+、气泡式。
- **可借**：**群聊里每条气泡带头像**；**系统卡（checklist）夹在对话流中**。
- **不可借**：粉紫渐变、手机模型、trend chips。

### 8. `Snipaste_2026-11-01_22-01-36.png`（GitHub Copilot · 会话态，**最重要**）

- **内容**：三栏工作台。左 180px 导航（Home / Pull requests / Issues / Automations / Customize / Sessions + 会话列表 `Fix dark mode toggle` 选中）；中间对话（顶部 `/pr-revoke-comment 18401` 徽标；**过程行一行一条、无边框无底色**：`🔧 View ThemeToggle.tsx`、`>_ Run the focused Theme… suite`、`+1`，末尾极小 `5s`；然后是正文段落）；右 420px PR 详情（`Deployed` 条、`Overview / Changes +4 -2`、`#184`、`merged` 徽标、2 reviewers、2 items、`maya-chen` 摘要卡）。
- **风格配色**：极简灰阶、无边框过程行、圆角 8。
- **可借**：过程行"一行一条 + 极小耗时"（Task 0014 已采用）；**参与者名字 + 时间在卡片头**。
- **不可借**：逐条列工具（我们单轮可达 194 次，见 `reference-baseline.md` 对话区一节）。

### 9. `Snipaste_2026-11-01_22-05-25.png`（GitHub Copilot · 评审态，**最重要**）

- **内容**：同一工作台的评审进行中状态。右栏变成参与者评论流：`github-copilot` 卡片（**头像 + 名字 + 时间 + `⋯` + 正文 + 动作条 `Reply / Fix ✓ / Resolve`**）、`Action required (1)` 分组清单（Copilot code review ✓ / Build 进行中 / CodeQL 扫描进行中 / `ThemeToggle /restores saved preference` ✓，各带三态图标）、底部富文本工具栏。
- **风格配色**：同上。
- **可借**：**"参与者一行 = 头像 + 名字 + 时间 + 动作条"**（Task 0015 头像方案的直接依据）；**清单里的三态图标（✓ / 空心圈 / 进行中）**。
- **不可借**：深色富文本工具栏。

## 什么时候读

1. **先读本文件**。要回答"这批图里有没有 X 的版式"、"某张图的可借/不可借是什么"——本文件能答，就**不读图**。
2. 只有需要核对**具体视觉细节**（间距、圆角、颜色、某槽位的相对位置）时才读图。
3. 正式的设计结论要在 `knowledge/reference-baseline.md` 落条文；本文件只做素材索引。

## 怎么读（省 token 的三级阶梯）

**第一级 · 联系表（contact sheet）：先看全貌，一张图 ≈ 1.7k token**

```bash
# 在仓库根执行：14 张缩略拼成一张 4×4 联系表（输出到 /tmp，不入库）
python3 - <<'PY'
import subprocess, glob, os
src = sorted(glob.glob('frontend/resources/*.webp') + glob.glob('frontend/resources/Snipaste_*.png'))
os.makedirs('/tmp/ref480', exist_ok=True)
thumbs = []
for f in src:
    out = '/tmp/ref480/' + os.path.splitext(os.path.basename(f))[0] + '.jpg'
    subprocess.run(['sips','-s','format','jpeg','-s','formatOptions','60','-Z','480',f,'--out',out],
                   capture_output=True)
    thumbs.append(out)
W,H,C = 480,340,4
cmd = ['ffmpeg','-y']
for t in thumbs: cmd += ['-i', t]
filt = [f'[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0xe5e7eb,setsar=1[v{i}]'
        for i in range(len(thumbs))]
n = C*((len(thumbs)+C-1)//C)
for i in range(len(thumbs), n):
    filt.append(f'color=c=0xe5e7eb:s={W}x{H}:d=1[v{i}]')
filt.append(''.join(f'[v{i}]' for i in range(n)) +
            f'xstack=inputs={n}:layout=' + '|'.join(f'{(i%C)*W}_{(i//C)*H}' for i in range(n)) + ':fill=0xe5e7eb[out]')
subprocess.run(cmd + ['-filter_complex',';'.join(filt),'-map','[out]','-frames:v','1','-q:v','6','/tmp/ref-contact.jpg'])
print('/tmp/ref-contact.jpg')
PY
```

**第二级 · 单张缩略（480px / q60）：确认细节，≈ 230 token / 张**

```bash
sips -s format jpeg -s formatOptions 60 -Z 480 frontend/resources/<file> --out /tmp/ref-one.jpg
```

**第三级 · 原图**：只有在量像素（圆角半径、字号、间距）时才读，且**一次只读一张**。

**实测对照（本目录 14 张）**

| 方式 | 字节 | 图像 token（按长边 1568 缩放后 宽×高÷750） |
|---|---|---|
| 全量读原图 | 4,241,434 | **≈ 33,700** |
| 全量读 480/q60 缩略 | 327,934 | ≈ 3,200 |
| **只看联系表（1920×1360）** | 120–174 KB | **≈ 3,500** |
| **联系表 + 1 张缩略** | ≈ 140 KB | **≈ 3,700** |
| 只读本文件的文字索引 | 0 | **0** |

→ 文字索引 > 联系表 > 单张缩略 > 原图，每一级约差一个量级（全量读 ↔ 联系表差 **≈ 10 倍**，全量读 ↔ 只读文字索引差 **无穷**）。日常讨论只需前两级。

> 两个口径分开写是故意的：**字节**决定请求体（网关 3.5MB 硬线，见 `knowledge/design/image-input.md`），**像素**决定图像 token。二者不成正比（webp 压缩率高，字节小但像素不变），所以不能只报一个。

## 新增 / 更换参考图时

1. 文件名保留原始内容哈希或 `Snipaste_<日期>_<时间>.png`（不重命名成"图1/图2"，避免与历史结论错位）；
2. 在本文件「里面有什么」加一行（尺寸、字节、一句话是什么）；
3. 在本文件「每张图说了什么」补一段**按固定五字段写**（内容 / 布局 / 风格配色 / 可借 / 不可借）；
4. 若结论成为规范条文，去 `knowledge/reference-baseline.md` 落条文并在本文件留指针；
5. **不要**把图复制到别处（`/tmp` 里的是派生缩略，可随时重生成）。

## 已知事实与失效条件

- 本目录 `.gitignore` 忽略所有文件，仅本文件例外（参考图属用户私有素材，未取得再分发许可，不进仓库）。
- 尺寸与字节为 2026-11-02 用 `sips` / `stat` 实测；图被替换后需重测。
- token 换算是**按字节的粗算**（口径来自 `knowledge/design/image-input.md:41`），与具体模型的图像编码有关，只能用来比较量级，不能当精确预算。
