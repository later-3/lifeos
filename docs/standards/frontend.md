# 前端规范

> 角色：开发　类型：约束　状态：目标（Hello World 起生效，边做边补）

## 技术栈

- Vite + React + TypeScript，样式用 **Tailwind CSS v4**。
- 暂不引入组件库/状态库/请求库；需要弹层、选择器等控件时再讨论。
- 前端只做界面与交互：**所有事实来自后端 API**，前端不保存真相，刷新即重取。

## 目录与命名

- `frontend/src/main.tsx` 挂载；`frontend/src/App.tsx` 页面根。
- 组件多了再建 `frontend/src/components/`（**不预建空目录**）；组件文件 `PascalCase.tsx`，工具函数 `kebab-case.ts`。
- 样式一律写 Tailwind 类；确实需要时用 `*.module.css`，不写全局样式表。

## 数据与事件流

- 发消息：`POST /api/agents/:id/sessions/:sid/messages` 拿 `turnId` → `GET /api/agents/:id/turns/:turnId/events`（SSE）订阅输出。
- SSE 事件：`delta`（文本增量）、`done`、`error`；断线用游标续订。
- 请求失败：把 `error.message` 显示给用户，不静默吞掉。

## 交互与状态

- 加载 / 空 / 错误三种状态必须显式呈现；请求进行中按钮禁用。
- 输入框：Enter 发送、Shift+Enter 换行；生成中显示「停止」（调用 interrupt）。
- 消息列表自动滚到底部；用户手动上滚时不强制跟随。

## 视觉（最小约定）

- 字号：14（正文）/ 16（标题）/ 20（页面标题）；间距：4 / 8 / 12 / 16；圆角 6px。
- 颜色用语义：背景、前景、边框、主色、危险色；不写死品牌色十六进制到组件里。
- 代码、路径、模型名用等宽字体。
- 移动端：窄屏单列，输入框吸底，注意安全区。

## 可访问性与质量

- 用语义标签；可点击的用 `<button>`；输入框有可见标签或 `aria-label`；焦点可见。
- 不用 `dangerouslySetInnerHTML`；Markdown 渲染等引入库时单独讨论。
- 关键纯函数（如事件流解析、时间格式化）写单测（`frontend/lib/*.test.mjs`）。
