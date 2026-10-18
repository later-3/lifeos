import { useEffect, useRef, useState } from "react";
import { IconUpload, IconTrash } from "@tabler/icons-react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { Modal } from "./design/overlay";
import { Button, Field, Label, Segmented, controlClass } from "./design/ui";
import { useToast } from "./design/toast";

// Agent 配置（点头像进入）：基础信息（头像/名字/描述/身份）+ 个人模型配置。
// 视觉与交互约束：模态语义/焦点陷阱/Esc 由 design/overlay.tsx 统一提供；保存反馈走全局 Toast；
// 表单控件只用 primitive（Field/controlClass/Button），不再各页自绘一套。

type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type ModelEntry = { id: string; name?: string; reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> } & Record<string, unknown>;
type ModelsConfig = {
  providers: Array<{ id: string; baseUrl: string; models: ModelEntry[] }>;
  settings: { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: string } | null;
};
type AgentModelConfig = { defaultProvider: string; defaultModel: string; defaultThinkingLevel?: string } | null;

const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LABEL: Record<string, string> = {
  off: "off · 不思考", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};

export function AgentConfigModal({ agent, onSaved, onClose }: {
  agent: Agent;
  onSaved: (updated: Agent) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"basic" | "model">("basic");
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [avatar, setAvatar] = useState<AgentAvatarSpec | undefined>(agent.avatar);
  const [identity, setIdentity] = useState("");
  const [models, setModels] = useState<ModelsConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = (next: Partial<Agent>) => onSaved({ ...agent, name, description, avatar, ...next });

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [identityRes, modelsRes, configRes] = await Promise.all([
        fetch(`/api/agents/${agent.id}/identity`),
        fetch("/api/models-config"),
        fetch(`/api/agents/${agent.id}/config`),
      ]);
      const identityData = await identityRes.json() as { text: string };
      const modelsData = await modelsRes.json() as ModelsConfig;
      const configData = await configRes.json() as { config: AgentModelConfig };
      if (!alive) return;
      setIdentity(identityData.text);
      setModels(modelsData);
      const cfg = configData.config;
      const providerId = cfg?.defaultProvider ?? modelsData.settings?.defaultProvider ?? modelsData.providers[0]?.id ?? "";
      const providerModels = modelsData.providers.find((p) => p.id === providerId)?.models ?? [];
      setProvider(providerId);
      setModel(cfg?.defaultModel ?? providerModels[0]?.id ?? "");
      setThinking(cfg?.defaultThinkingLevel ?? "");
    })();
    return () => { alive = false; };
  }, [agent.id]);

  const providerModels = models?.providers.find((p) => p.id === provider)?.models ?? [];
  const activeModel = providerModels.find((entry) => entry.id === model);
  // 思考档位只列该模型真正支持的（thinkingLevelMap 里为 null 的档位不支持）
  const thinkingOptions = activeModel?.thinkingLevelMap === undefined
    ? []
    : THINKING_ORDER.filter((level) => activeModel.thinkingLevelMap?.[level] !== null && (level !== "xhigh" && level !== "max" || activeModel.thinkingLevelMap?.[level] !== undefined));
  const modelCount = (models?.providers ?? []).reduce((sum, p) => sum + p.models.length, 0);
  const noModels = models !== null && models.providers.length === 0;

  async function saveBasic() {
    setBusy(true);
    try {
      const [agentRes, identityRes] = await Promise.all([
        fetch(`/api/agents/${agent.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description }),
        }),
        fetch(`/api/agents/${agent.id}/identity`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: identity }),
        }),
      ]);
      if (!agentRes.ok || !identityRes.ok) {
        const data = await agentRes.json().catch(() => ({})) as { error?: { message: string } };
        toast(data.error?.message ?? "保存失败", "error");
        return;
      }
      const updated = await agentRes.json() as Agent;
      notify({ name: updated.name, description: updated.description, avatar });
      toast("基础信息已保存");
    } catch { toast("网络错误", "error"); }
    finally { setBusy(false); }
  }

  async function saveModel() {
    setBusy(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/config`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultProvider: provider, defaultModel: model, defaultThinkingLevel: thinking }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: { message: string } };
        toast(data.error?.message ?? "保存失败", "error");
        return;
      }
      toast("模型配置已保存");
    } catch { toast("网络错误", "error"); }
    finally { setBusy(false); }
  }

  async function uploadAvatar(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const response = await fetch(`/api/agents/${agent.id}/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: base64 }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: { message: string } };
      toast(data.error?.message ?? "头像上传失败", "error");
      return;
    }
    const { avatar: next } = await response.json() as { avatar: AgentAvatarSpec };
    setAvatar(next);
    notify({ avatar: next });
    toast("头像已更新");
  }

  async function resetAvatar() {
    const response = await fetch(`/api/agents/${agent.id}/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }),
    });
    if (!response.ok) return;
    setAvatar(undefined);
    notify({ avatar: undefined });
    toast("已恢复自动头像");
  }

  return (
    <Modal title="配置助手" subtitle={`agents/${agent.id}/`} onClose={onClose} width={640}
      icon={<AgentAvatar id={agent.id} name={name || agent.name} avatar={avatar} size={32} />}
      footer={<>
        <span className="mr-auto text-micro text-ink-500">
          {tab === "basic" ? "名字/描述写 agent.json，身份写 identity.md" : `保存于 agents/${agent.id}/workspace/config.json`}
        </span>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="primary" disabled={busy || (tab === "basic" && name.trim() === "") || (tab === "model" && (provider === "" || model === ""))}
          onClick={() => void (tab === "basic" ? saveBasic() : saveModel())}>
          {busy ? "保存中…" : tab === "basic" ? "保存基础信息" : "保存模型配置"}
        </Button>
      </>}>
      <div className="mb-4">
        <Segmented value={tab} onChange={setTab}
          options={[{ value: "basic", label: "基础信息" }, { value: "model", label: "模型" }]} />
      </div>

      {tab === "basic" ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <AgentAvatar id={agent.id} name={name || agent.name} avatar={avatar} size={64} />
            <div className="flex flex-col items-start gap-1.5">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void uploadAvatar(file); event.currentTarget.value = ""; }} />
              <Button size="sm" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> 更换头像</Button>
              {avatar?.kind === "image" && (
                <Button size="sm" variant="ghost" onClick={() => void resetAvatar()}><IconTrash size={14} /> 恢复自动头像</Button>
              )}
              <span className="text-micro text-ink-500">png / jpg / webp，≤2MB</span>
            </div>
          </div>

          <Field label="名字">
            <input className={`${controlClass} h-9`} value={name} maxLength={60}
              onChange={(event) => setName(event.target.value)} placeholder="展示名" />
          </Field>

          <Field label="描述" hint="一句话说明这个助手负责什么">
            <input className={`${controlClass} h-9`} value={description} maxLength={300}
              onChange={(event) => setDescription(event.target.value)} placeholder="一句话介绍" />
          </Field>

          <Field label="身份信息" hint="identity.md —— 模型读的“我是谁”：身份与职责、人格与性格">
            <textarea className={`${controlClass} min-h-40 resize-y py-2 font-mono text-meta leading-relaxed`}
              value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="身份与职责、人格与性格…" />
          </Field>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-baseline justify-between">
            <Label>模型配置</Label>
            <span className="text-micro text-ink-500">
              {models === null ? "加载中…" : noModels ? "未解析到模型" : `${models.providers.length} 个服务 · ${modelCount} 个模型`}
            </span>
          </div>
          {noModels ? (
            <p className="rounded-panel bg-sunken px-3 py-4 text-center text-body text-ink-700">
              还没解析到任何模型——请先配置 <span className="font-mono text-micro">~/.lifeos/config/models.json</span>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="服务">
                  <select className={`${controlClass} h-9`} value={provider}
                    onChange={(event) => {
                      const next = event.target.value;
                      setProvider(next);
                      setModel(models?.providers.find((p) => p.id === next)?.models[0]?.id ?? "");
                    }}>
                    {models?.providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                  </select>
                </Field>
                <Field label="模型">
                  <select className={`${controlClass} h-9`} value={model} onChange={(event) => setModel(event.target.value)}>
                    {providerModels.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.name !== undefined && entry.name !== "" ? entry.name : entry.id}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="思考级别" hint={thinkingOptions.length === 0 ? "该模型未声明思考档位" : `该模型支持：${thinkingOptions.join(" / ")}`}>
                <select className={`${controlClass} h-9`} value={thinking} onChange={(event) => setThinking(event.target.value)}>
                  <option value="">未设置（跟随系统默认）</option>
                  {thinkingOptions.map((level) => <option key={level} value={level}>{THINKING_LABEL[level] ?? level}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
