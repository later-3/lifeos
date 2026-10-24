# 任务模板（troubleshooting · 问题定位修复）

用途：独立于 development 类型，承载"在现有系统里**要找到为什么**"的工作。类型规则在 `AGENTS.md`（语气分级、三硬约束、三段流程、判据转需求、同类风险、心智模型）。

## 1 类别（template.json）

- **A 仅定位**：只出根因卡片（01-background + 02-conclusion）。适合"现象 / 根因 / 行业参考"都能在 task 内闭环，但"是否修"需要用户再拍板的场景；
- **B 直接修**：（默认）01-background（现象/根因/行业参考/同类风险/修复方案）+ 02-fix（变更点/同类修/测试先红后绿/回滚）+ log；
- **C 转需求**：判出架构层问题，则 **应该** 建一个 development 类型新 Task 承接修复（那个 Task 才是编码工程），本 troubleshooting 目录只承载根因+转需求引用（01-background + 02-referral）。

## 2 task.md 骨架

```md
# <任务名>

ID: NNNN
类型：troubleshooting
类别：A 仅定位 / B 直接修 / C 转需求
状态：进行中
负责人 / 记录者
日期
目标：一句话（可验收）
必需文档：01-background（+02-fix or 02-conclusion or 02-referral · log.md）
当前指针
```

## 3 文档内容要求（内容要求由 skeleton dir-*.md 驱动，此处仅提示）

- 01-background.md：现象 → 证据收集 → 根因（因果链） → 行业参考 → 同类风险 / 修复方案（或 转需求 依据）；
- 02-fix.md / 02-conclusion.md / 02-referral.md：按类别看对应；
- `cases/<日期>.md` 按协议 §3.4 的三段落结构（正例 / 反例 / 标签）；
- 流程"语气分级（必须 / 应该 / 可以）"见 AGENTS.md。
