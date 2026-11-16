/**
 * 主题效果预览区（Task 0015 · S2）——**活组件，不是截图**。
 *
 * 用户选一个主题，这里立刻展示该主题下的全部代表 primitive：
 * 按钮四变体、图标钮、输入框、下拉、开关、徽标、状态点、图标、
 * 三种消息气泡、代码块（语法色）、diff 行（增删色）、批注色。
 *
 * 为什么放设置页而不是 /dev/design-system.html（用户 2026-11-13 要求）：
 * 主题化的验收标准是"选主题即所见"——藏在开发页里等于没有可视化验证。
 *
 * 纪律：本文件**不写任何颜色/数值字面量**（lint:tokens 门禁），全部走语义 utility；
 * 所以它天然随主题变——不需要"预览专用配色"，那反而是失真。
 */
import { AppIcon } from "./icons";
import { Button, Field, IconButton, Row, Segmented, Spinner } from "./ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro font-medium text-ink-500">{title}</span>
      <div className="rounded-panel border border-line bg-surface p-3">{children}</div>
    </div>
  );
}

export function ThemePreview() {
  return (
    <div className="flex flex-col gap-3" data-theme-preview>
      <Section title="按钮 · 四种变体 / 两种尺寸 / 禁用">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">主操作</Button>
          <Button variant="secondary">次级</Button>
          <Button variant="ghost">幽灵</Button>
          <Button variant="danger">危险</Button>
          <Button variant="primary" size="sm">小号</Button>
          <Button variant="primary" disabled>禁用</Button>
        </div>
      </Section>

      <Section title="图标钮 · 图标（当前图标集）">
        <div className="flex flex-wrap items-center gap-2">
          <IconButton label="设置" size="sm"><AppIcon name="settings" size={14} /></IconButton>
          <IconButton label="搜索" size="sm"><AppIcon name="file-text" size={14} /></IconButton>
          <IconButton label="文件夹" size="sm"><AppIcon name="folder" size={14} /></IconButton>
          <IconButton label="加" size="sm"><AppIcon name="plus" size={14} /></IconButton>
          <IconButton label="删除" size="sm"><AppIcon name="trash" size={14} /></IconButton>
          <IconButton label="勾选" size="sm" active><AppIcon name="check" size={14} /></IconButton>
          <span className="mx-1 h-4 w-px bg-line" />
          <span className="flex items-center gap-1.5 text-ink-700">
            <AppIcon name="folder-open" size={16} />
            <AppIcon name="history" size={16} />
            <AppIcon name="pencil" size={16} />
            <AppIcon name="upload" size={16} />
            <AppIcon name="photo" size={16} />
            <AppIcon name="info" size={16} />
          </span>
        </div>
      </Section>

      <Section title="表单 · 输入 / 选择 / 分段">
        <div className="flex flex-col gap-2.5">
          <Field label="输入框" hint="提示文字用 ink-500，边框用 line">
            <input
              defaultValue="示例内容"
              className="h-9 w-full rounded-control bg-sunken px-2.5 text-body text-ink-900 ring-1 ring-line placeholder:text-ink-300 focus:outline-none focus:ring-accent"
            />
          </Field>
          <Field label="下拉">
            <select className="h-9 w-full rounded-control bg-sunken px-2 text-body text-ink-900 ring-1 ring-line focus:outline-none focus:ring-accent">
              <option>选项一</option>
              <option>选项二</option>
            </select>
          </Field>
          <div className="flex items-center gap-3">
            {/* 命中区：复选框/单选本体是浏览器默认 14×14，由 label 撑到 ≥28（规范 2.15 次级密集控件档） */}
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-body text-ink-700">
              <input type="checkbox" defaultChecked className="h-3.5 w-3.5 accent-accent" /> 复选
            </label>
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-body text-ink-700">
              <input type="radio" defaultChecked className="h-3.5 w-3.5 accent-accent" /> 单选
            </label>
            <Segmented value="a" options={[{ value: "a", label: "分段" }, { value: "b", label: "控件" }]} onChange={() => undefined} />
          </div>
        </div>
      </Section>

      <Section title="状态 · 徽标 / 状态点 / 加载">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-micro font-medium text-success">3</span>
          <span className="rounded-full bg-danger-soft px-1.5 py-0.5 text-micro font-medium text-danger">失败</span>
          <span className="rounded-full bg-running-soft px-1.5 py-0.5 text-micro font-medium text-running">生成中</span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-running animate-dot-breathe" aria-hidden />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-300" aria-hidden />
          <Spinner size={14} />
          <span className="text-micro text-ink-500">辅助文字 ink-500</span>
          <span className="text-micro text-ink-300">装饰 ink-300</span>
        </div>
      </Section>

      <Section title="列表行 · 选中 / 常态">
        <div className="flex flex-col gap-1 rounded-none bg-nav-bg p-1.5">
          <Row selected onClick={() => undefined} status={<span className="text-micro text-nav-muted">2 未读</span>}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-micro font-semibold text-surface">L</span>
            <span className="truncate">选中的行</span>
          </Row>
          <Row onClick={() => undefined} status={<span className="text-micro text-nav-muted">昨天</span>}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-micro font-semibold text-surface">F</span>
            <span className="truncate">常态的行</span>
          </Row>
        </div>
      </Section>

      <Section title="消息 · 用户 / 助手 / 失败">
        <div className="flex flex-col gap-2">
          <div className="ml-auto rounded-bubble bg-message-user px-3 py-1.5 text-body text-white" style={{ maxWidth: "var(--container-bubble)" }}>用户气泡（message-user 底 + 白字）</div>
          <div className="rounded-bubble bg-message-tool px-3 py-1.5 text-body text-ink-900" style={{ maxWidth: "var(--container-bubble)" }}>工具块（message-tool）</div>
          <div className="rounded-bubble bg-message-tool-done px-3 py-1.5 text-body text-success" style={{ maxWidth: "var(--container-bubble)" }}>完成块（success-soft 系）</div>
          <div className="rounded-bubble bg-message-failure px-3 py-1.5 text-body text-danger" style={{ maxWidth: "var(--container-bubble)" }}>失败块（danger-soft 系）</div>
        </div>
      </Section>

      <Section title="代码 · 语法色 / diff 增删 / 表头">
        <pre className="overflow-x-auto rounded-inner bg-hover px-2 py-1.5 font-mono text-micro leading-relaxed">
          <span className="text-syn-comment">// 注释</span>{"\n"}
          <span className="text-syn-keyword">const</span> <span className="text-syn-function">greet</span> = <span className="text-syn-string">"hello"</span>;{"\n"}
          <span className="text-syn-keyword">return</span> <span className="text-syn-number">42</span> <span className="text-syn-punctuation">+</span> <span className="text-syn-constant">PI</span>;{"\n"}
          <span className="text-syn-type">Promise</span>&lt;<span className="text-syn-type">string</span>&gt;
        </pre>
        <div className="mt-2 overflow-hidden rounded-inner border border-line font-mono text-micro">
          <div className="bg-diff-add-soft px-2 py-0.5 text-diff-add">+ 新增的行</div>
          <div className="bg-diff-del-soft px-2 py-0.5 text-diff-del">- 删除的行</div>
          <div className="bg-diff-mod-soft px-2 py-0.5 text-diff-mod">~ 修改的行</div>
        </div>
        <div className="mt-2 overflow-hidden rounded-inner border border-line">
          <div className="bg-table-head px-2 py-1 text-micro font-medium text-ink-900">表头（table-head）</div>
          <div className="px-2 py-1 text-micro text-ink-700">表格行（内容底）</div>
        </div>
      </Section>

      <Section title="批注 · 五种语气">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["query", "critic", "praise", "archive", "todo"] as const).map((tone) => {
            const label = { query: "提问", critic: "反对", praise: "鼓励", archive: "存档", todo: "待办" }[tone];
            return (
              <span key={tone} className={`rounded-full px-1.5 py-0.5 text-micro font-medium ${tone === "query" ? "bg-anno-query-soft text-anno-query" : tone === "critic" ? "bg-anno-critic-soft text-anno-critic" : tone === "praise" ? "bg-anno-praise-soft text-anno-praise" : tone === "archive" ? "bg-anno-archive-soft text-anno-archive" : "bg-anno-todo-soft text-anno-todo"}`}>
                {label}
              </span>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
