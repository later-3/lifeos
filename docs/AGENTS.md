# docs/

面向**使用者**的文档（不是内部设计文档——那些在 `.lifeos/projects/lifeos/knowledge/`）。

## 里面有什么

| 文件 | 是什么 |
|---|---|
| `getting-started.md` | 完整安装与排障：代理、家目录校验、两种运行模式、更新 Pi SDK、常见问题 |
| `images/` | README 引用的截图与动图。**入库**（Task 0022 D4）：相对路径才能让 PR 看到图的变化 |

## 什么时候读

- 用户问"怎么装 / 装不上 / 端口被占"→ `getting-started.md`；
- 要改 README 的配图 → 先看 `images/` 现有文件，重拍用 `scripts/readme-studio/`（说明书在同一目录）。

## 怎么用（规则）

- **必须** 这里是**对外**文档：不写运维凭据、隧道 ID、本机路径、真实用户数据。
- **必须** 图片用相对路径（`docs/images/x.webp`），不用外链；单个文件 ≤10MB（GitHub 上限）。
- **必须** 新增/替换图片时同步 README 两份（`README.md` 与 `README.zh-CN.md`），
  否则 `test/doc-links.test.mjs` 会报两版图片集合不一致。
- **应该** 与 README 分工：README 只留「前置要求 + 命令」，细节放这里。
