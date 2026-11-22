/**
 * 「写一条」模态（Task 0023 · S1 第 2 块的 rail ⊞ 动作）。
 *
 * S1 只有**骨架**：字段与交互现在定形（标题可空 / 正文 / 标签决定类型 / 可选关联项目），
 * 发布在 S2 接 Agent 工具（用户裁决定 #3：发布是工具，参数自带项目/Task，格式由工具生成）。
 * 所以「发布」点了给 toast 说明——**不给"已经发布了"的假反馈**，也不静默无效。
 *
 * 预览切换不在 S1（发布格式是 S2 的事；预览渲染器也不在本次范围）。
 */
import { useState, useEffect } from "react";
import { Modal } from "../design/overlay";
import { Button, Field, controlClass, ToggleChip } from "../design/ui";
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
        <Field label="正文" hint="Markdown；渲染与预览随发布（S2）一起接入。">
          <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} rows={6}
            className={`${controlClass} resize-y`} placeholder="写点什么…" />
        </Field>
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
