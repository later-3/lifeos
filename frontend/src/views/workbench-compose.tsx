/**
 * 「写一条」模态（Task 0023 · S1 第 2 块的 rail ⊞ 动作）。
 *
 * S1 只有**骨架**：字段与交互现在定形（标题可空 / 正文 / 标签决定类型 / 可选关联项目），
 * 发布在 S2 接 Agent 工具（用户裁决定 #3：发布是工具，参数自带项目/Task，格式由工具生成）。
 * 所以「发布」点了给 toast 说明——**不给"已经发布了"的假反馈**，也不静默无效。
 *
 * **编辑 / 预览切换**（Task 0023 · 修正批 4 · 用户原话「md 编辑和预览」）：
 * 预览用对话区同一个 `Markdown` 渲染链路（marked → DOMPurify → 代码块着色），
 * 不新写渲染器。切走再切回**内容不丢**（正文只在 `text` 一个 state 里）。
 * 发布本身仍等 S2（发布是 Agent 工具，格式由工具生成）。
 */
import { useState, useEffect } from "react";
import { Modal } from "../design/overlay";
import { Button, Field, Segmented, controlClass, ToggleChip } from "../design/ui";
import { Markdown } from "./message-markdown";
import { useToast } from "../design/toast";
import { fetchGlobalProjects } from "../api/workbench";

/** 标签池（demo 已验证的 8 个；"笔记"也是一个标签——类型由标签决定，没有独立"类型"选项）。 */
const TAG_POOL = ["笔记", "日记", "复盘", "读书", "家庭设备", "网络", "工作", "想法"];

export function WorkbenchCompose({ onClose }: {
  onClose: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [project, setProject] = useState("");
  /* 关联项目的补全候选：模态每次打开现取一次 /api/projects（同一端点，不是第二份事实源）；
     取不到就空 datalist —— 补全是锦上添花，不该让它拦住写字。 */
  const [projectNames, setProjectNames] = useState<string[]>([]);
  /** 编辑 / 预览（用户 2026-11-23：「md 编辑和预览」）。切走再切回内容不丢。 */
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchGlobalProjects();
      if (!cancelled && result.ok) setProjectNames(result.value.map((item) => item.name));
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Modal title="写一条" subtitle="S1 骨架：发布在 S2 接 Agent 工具" onClose={onClose} width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => { toast("这是骨架——发布在 S2 接 Agent 工具后可用", "success"); onClose(); }}>
            发布
          </Button>
        </>
      }>
      <div className="space-y-4">
        <Field label="标题（可空）">
          <input value={title} onChange={(event) => setTitle(event.currentTarget.value)}
            className={controlClass} placeholder="不填就不显示标题" />
        </Field>
        {/* 正文：编辑 / 预览（同一个 text state，切换不丢内容） */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-ink-700">正文</span>
            <Segmented value={mode} onChange={setMode}
              options={[{ value: "edit", label: "编辑" }, { value: "preview", label: "预览" }]} />
          </div>
          {mode === "edit" ? (
            <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} rows={6}
              aria-label="正文（Markdown）"
              className={`${controlClass} resize-y`} placeholder="写点什么…（支持 Markdown）" />
          ) : (
            <div data-testid="compose-preview"
              className="min-h-36 rounded-control bg-sunken px-2.5 py-2 ring-1 ring-line">
              {text.trim() === ""
                ? <p className="text-meta text-ink-500">还没有内容——切回「编辑」写点什么。</p>
                : <Markdown text={text} className="text-body" />}
            </div>
          )}
          <span className="block text-micro text-ink-500">
            Markdown；预览用对话区同一条渲染链路。发布在 S2 接 Agent 工具后可用。
          </span>
        </div>
        <Field label="标签" hint="决定它出现在哪里；「笔记」也是一个标签。">
          <div className="flex flex-wrap gap-1.5">
            {TAG_POOL.map((tag) => (
              <ToggleChip key={tag} pressed={tags.includes(tag)}
                onClick={() => setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}>
                {tag}
              </ToggleChip>
            ))}
          </div>
        </Field>
        <Field label="关联项目（可选）" hint="留空 = 不属于任何项目。">
          <input value={project} onChange={(event) => setProject(event.currentTarget.value)} list="workbench-project-names"
            className={controlClass} placeholder="不填就是不属于任何项目" />
          <datalist id="workbench-project-names">
            {projectNames.map((name) => <option key={name} value={name} />)}
          </datalist>
        </Field>
      </div>
    </Modal>
  );
}
