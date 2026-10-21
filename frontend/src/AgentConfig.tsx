import { useEffect, useRef, useState } from "react";
import { IconUpload, IconTrash } from "@tabler/icons-react";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { ConfirmDialog, Modal } from "./design/overlay";
import { Button, Field, Label, controlClass } from "./design/ui";
import { useToast } from "./design/toast";

// Agent 配置（点头像进入）：基础信息（头像/名字/描述/身份）+ 同页运行配置（默认模型）。
// 布局依据 frontend-spec §3.1 与 reference-baseline：LobeHub Agent Profile 的“顶部 profile
// header + 同页 runtime config 面板 + editor”，不做 Tab/左栏；模型配置属于同页 section。
//
// 保存域保持独立：基础信息（agent/identity）与模型配置（config）接口不同，分别有保存动作；
// 关闭时统一做脏检查，避免任一 section 的改动被静默丢弃。

type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type ModelEntry = { id: string; name?: string; reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> } & Record<string, unknown>;
type ModelsConfig = {
  providers: Array<{ id: string; baseUrl: string; models: ModelEntry[] }>;
  settings: { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: string } | null;
};
type AgentModelConfig = { defaultProvider: string; defaultModel: string; defaultThinkingLevel?: string } | null;
type LoadState = "loading" | "ready" | "error";

const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LABEL: Record<string, string> = {
  off: "off · 不思考", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};
const IDENTITY_LIMIT_BYTES = 64 * 1024;
const AVATAR_LIMIT_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

type Snapshot = {
  name: string; description: string; identity: string; avatarKey: string;
  provider: string; model: string; thinking: string;
};

const avatarKeyOf = (avatar: AgentAvatarSpec | undefined): string =>
  avatar === undefined ? "" : `${avatar.kind ?? ""}:${avatar.file ?? ""}:${avatar.revision ?? 0}`;

function ErrorNote({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-meta text-danger">
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="sm" onClick={onRetry}>重试</Button>
    </div>
  );
}

export function AgentConfigModal({ agent, onSaved, onClose }: {
  agent: Agent;
  onSaved: (updated: Agent) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  const [avatar, setAvatar] = useState<AgentAvatarSpec | undefined>(agent.avatar);
  const [identity, setIdentity] = useState("");
  const [models, setModels] = useState<ModelsConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [busy, setBusy] = useState(false);
  const [identityState, setIdentityState] = useState<LoadState>("loading");
  const [identityError, setIdentityError] = useState("");
  const [modelsState, setModelsState] = useState<LoadState>("loading");
  const [modelsError, setModelsError] = useState("");
  const [initial, setInitial] = useState<Snapshot>();
  const [confirmClose, setConfirmClose] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  async function loadIdentity(): Promise<void> {
    setIdentityState("loading");
    setIdentityError("");
    try {
      const response = await fetch(`/api/agents/${agent.id}/identity`);
      if (!response.ok) throw new Error(`身份加载失败（${response.status}）`);
      const data = await response.json() as { text?: string };
      if (!alive.current) return;
      setIdentity(data.text ?? "");
      setIdentityState("ready");
    } catch (error) {
      if (!alive.current) return;
      setIdentityState("error");
      setIdentityError(error instanceof Error ? error.message : "身份加载失败");
    }
  }

  async function loadModels(): Promise<void> {
    setModelsState("loading");
    setModelsError("");
    try {
      const [modelsRes, configRes] = await Promise.all([
        fetch("/api/models-config"),
        fetch(`/api/agents/${agent.id}/config`),
      ]);
      if (!modelsRes.ok) throw new Error(`模型目录加载失败（${modelsRes.status}）`);
      if (!configRes.ok) throw new Error(`模型配置加载失败（${configRes.status}）`);
      const modelsData = await modelsRes.json() as ModelsConfig;
      const configData = await configRes.json() as { config: AgentModelConfig };
      if (!alive.current) return;
      setModels(modelsData);
      const cfg = configData.config;
      const providerId = cfg?.defaultProvider ?? modelsData.settings?.defaultProvider ?? modelsData.providers[0]?.id ?? "";
      const providerModels = modelsData.providers.find((p) => p.id === providerId)?.models ?? [];
      setProvider(providerId);
      setModel(cfg?.defaultModel ?? providerModels[0]?.id ?? "");
      setThinking(cfg?.defaultThinkingLevel ?? "");
      setModelsState("ready");
    } catch (error) {
      if (!alive.current) return;
      setModelsState("error");
      setModelsError(error instanceof Error ? error.message : "模型目录加载失败");
    }
  }

  useEffect(() => {
    alive.current = true;
    setInitial(undefined);
    setIdentity("");
    setModels(null);
    setProvider("");
    setModel("");
    setThinking("");
    void loadIdentity();
    void loadModels();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // 基础信息一就绪就建立基线，避免模型目录失败时名字/描述改动无法判断脏。
  useEffect(() => {
    if (identityState !== "ready" || initial !== undefined) return;
    setInitial({ name, description, identity, avatarKey: avatarKeyOf(avatar), provider, model, thinking });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityState, initial]);

  // 模型目录就绪后补齐基线里的模型字段（首次加载/重试）。
  useEffect(() => {
    if (modelsState !== "ready" || initial === undefined || initial.provider !== "" || provider === "") return;
    setInitial({ ...initial, provider, model, thinking });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsState, provider, model, thinking]);

  const providerModels = models?.providers.find((p) => p.id === provider)?.models ?? [];
  const activeModel = providerModels.find((entry) => entry.id === model);
  const thinkingOptions = activeModel?.thinkingLevelMap === undefined
    ? []
    : THINKING_ORDER.filter((level) => activeModel.thinkingLevelMap?.[level] !== null && (level !== "xhigh" && level !== "max" || activeModel.thinkingLevelMap?.[level] !== undefined));
  const modelCount = (models?.providers ?? []).reduce((sum, p) => sum + p.models.length, 0);
  const noModels = models !== null && models.providers.length === 0;
  const dirty = initial !== undefined && (
    name !== initial.name
    || description !== initial.description
    || identity !== initial.identity
    || avatarKeyOf(avatar) !== initial.avatarKey
    || provider !== initial.provider
    || model !== initial.model
    || thinking !== initial.thinking
  );

  function requestClose() {
    if (busy) { toast("保存中，请稍候", "error"); return; }
    if (dirty) { setConfirmClose(true); return; }
    onClose();
  }

  const notify = (next: Partial<Agent>) => onSaved({ ...agent, name, description, avatar, ...next });

  async function saveBasic() {
    if (identityState !== "ready" || name.trim() === "") return;
    if (new TextEncoder().encode(identity).length > IDENTITY_LIMIT_BYTES) {
      toast("身份信息超过 64KB，请精简后再保存", "error");
      return;
    }
    setBusy(true);
    try {
      const agentRes = await fetch(`/api/agents/${agent.id}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description }),
      });
      if (!agentRes.ok) {
        const data = await agentRes.json().catch(() => ({})) as { error?: { message?: string } };
        toast(data.error?.message ?? "保存失败", "error");
        return;
      }
      const updated = await agentRes.json() as Agent;
      setName(updated.name);
      setDescription(updated.description ?? "");
      notify({ name: updated.name, description: updated.description, avatar });
      setInitial((prev) => prev === undefined ? prev : {
        ...prev, name: updated.name, description: updated.description ?? "", avatarKey: avatarKeyOf(avatar),
      });

      const identityRes = await fetch(`/api/agents/${agent.id}/identity`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: identity }),
      });
      if (!identityRes.ok) {
        const data = await identityRes.json().catch(() => ({})) as { error?: { message?: string } };
        toast(`名字/描述已保存；身份未保存：${data.error?.message ?? "请求失败"}`, "error");
        return;
      }
      setInitial((prev) => prev === undefined ? prev : { ...prev, identity });
      toast("基础信息已保存");
    } catch { toast("网络错误", "error"); }
    finally { setBusy(false); }
  }

  async function saveModel() {
    if (modelsState !== "ready" || noModels || provider === "" || model === "") return;
    setBusy(true);
    try {
      const response = await fetch(`/api/agents/${agent.id}/config`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultProvider: provider, defaultModel: model, defaultThinkingLevel: thinking }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
        toast(data.error?.message ?? "保存失败", "error");
        return;
      }
      setInitial((prev) => prev === undefined ? prev : { ...prev, provider, model, thinking });
      toast("模型配置已保存");
    } catch { toast("网络错误", "error"); }
    finally { setBusy(false); }
  }

  async function uploadAvatar(file: File) {
    if (!AVATAR_TYPES.includes(file.type)) { toast("只支持 png / jpg / webp", "error"); return; }
    if (file.size > AVATAR_LIMIT_BYTES) { toast("头像不能超过 2MB", "error"); return; }
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
      const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
      toast(data.error?.message ?? "头像上传失败", "error");
      return;
    }
    const { avatar: next } = await response.json() as { avatar: AgentAvatarSpec };
    setAvatar(next);
    setInitial((prev) => prev === undefined ? prev : { ...prev, avatarKey: avatarKeyOf(next) });
    notify({ avatar: next });
    toast("头像已更新（立即生效）");
  }

  async function resetAvatar() {
    const response = await fetch(`/api/agents/${agent.id}/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }),
    });
    if (!response.ok) return;
    setAvatar(undefined);
    setInitial((prev) => prev === undefined ? prev : { ...prev, avatarKey: "" });
    notify({ avatar: undefined });
    toast("已恢复自动头像（立即生效）");
  }

  const basicDisabled = busy || identityState !== "ready" || name.trim() === "";
  const modelDisabled = busy || modelsState !== "ready" || noModels || provider === "" || model === "";

  return (
    <>
      <Modal title="配置助手" onClose={requestClose} width={640} initialFocus={nameRef}
        icon={<AgentAvatar id={agent.id} name={name || agent.name} avatar={avatar} size={32} />}
        footer={<>
          <span className="mr-auto text-micro text-ink-500">基础信息保存后立即生效</span>
          <Button onClick={requestClose}>关闭</Button>
          <Button variant="primary" disabled={basicDisabled} onClick={() => void saveBasic()}>
            {busy ? "保存中…" : "保存基础信息"}
          </Button>
        </>}>
        <div className="space-y-6">
          {/* Profile header：头像 72 + 大标题/描述（LobeHub Agent Profile 同型） */}
          <div className="flex items-start gap-4" data-testid="agent-profile">
            <div className="flex w-20 shrink-0 flex-col items-center gap-1.5">
              <AgentAvatar id={agent.id} name={name || agent.name} avatar={avatar} size={72} />
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void uploadAvatar(file); event.currentTarget.value = ""; }} />
              <Button size="sm" className="w-full" onClick={() => fileRef.current?.click()}><IconUpload size={14} /> 更换</Button>
              {avatar?.kind === "image" && (
                <Button size="sm" variant="ghost" className="w-full" onClick={() => void resetAvatar()}><IconTrash size={14} /> 恢复</Button>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <Field label="名字">
                <input ref={nameRef} name="agent-name" autoComplete="off" className={`${controlClass} h-10 text-title font-semibold`}
                  value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="展示名" />
              </Field>
              <Field label="描述" hint="一句话说明这个助手负责什么">
                <input name="agent-description" autoComplete="off" className={`${controlClass} h-9`} value={description} maxLength={300}
                  onChange={(event) => setDescription(event.target.value)} placeholder="一句话介绍" />
              </Field>
              <p className="text-micro text-ink-500">png / jpg / webp，≤2MB · 更换后立即生效</p>
            </div>
          </div>

          {/* Runtime config：模型是同一页的配置面板，不是独立 Tab/页面 */}
          <section className="rounded-panel bg-sunken p-4" data-testid="agent-runtime">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label>运行配置</Label>
                <p className="mt-1 text-micro text-ink-500">这个助手的默认模型；保存后用于新会话。</p>
              </div>
              <Button variant="secondary" disabled={modelDisabled} onClick={() => void saveModel()}>
                {busy ? "保存中…" : "保存模型配置"}
              </Button>
            </div>
            <div className="mt-3">
              {modelsState === "loading" ? (
                <p className="py-3 text-body text-ink-500" aria-live="polite">模型目录加载中…</p>
              ) : modelsState === "error" ? (
                <ErrorNote message={modelsError} onRetry={() => void loadModels()} />
              ) : noModels ? (
                <p className="py-3 text-body text-ink-700">还没有可用模型。请先在 Life OS 中配置模型，再回来保存。</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-micro text-ink-500" />
                    <span className="text-micro text-ink-500">{models?.providers.length ?? 0} 个服务 · {modelCount} 个模型</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="服务">
                      <select name="agent-provider" className={`${controlClass} h-9`} value={provider}
                        onChange={(event) => {
                          const next = event.target.value;
                          setProvider(next);
                          setModel(models?.providers.find((p) => p.id === next)?.models[0]?.id ?? "");
                          setThinking("");
                        }}>
                        {models?.providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                      </select>
                    </Field>
                    <Field label="模型">
                      <select name="agent-model" className={`${controlClass} h-9`} value={model}
                        onChange={(event) => { setModel(event.target.value); setThinking(""); }}>
                        {providerModels.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.name !== undefined && entry.name !== "" ? entry.name : entry.id}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="思考级别" hint={thinkingOptions.length === 0 ? "该模型未声明思考档位" : `该模型支持：${thinkingOptions.join(" / ")}`}>
                    <select name="agent-thinking" className={`${controlClass} h-9`} value={thinking} onChange={(event) => setThinking(event.target.value)}>
                      <option value="">未设置（跟随系统默认）</option>
                      {thinkingOptions.map((level) => <option key={level} value={level}>{THINKING_LABEL[level] ?? level}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          </section>

          {/* Identity：bio 风格，同页 */}
          <section className="space-y-2" data-testid="agent-identity">
            <div className="flex items-baseline justify-between">
              <Label>身份</Label>
              <span className="text-micro text-ink-500">≤64KB</span>
            </div>
            {identityState === "error" && <ErrorNote message={identityError} onRetry={() => void loadIdentity()} />}
            <textarea name="agent-identity" disabled={identityState !== "ready"}
              className={`${controlClass} min-h-56 resize-y py-2 text-content leading-relaxed`}
              value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="身份与职责、人格与性格…" />
            <p className="text-micro text-ink-500">
              {identityState === "loading" ? "身份加载中…" : identityState === "error" ? "身份加载失败，重试后再保存" : "这个助手是谁、长期负责什么"}
            </p>
          </section>
        </div>
      </Modal>

      {confirmClose && (
        <ConfirmDialog title="放弃未保存的改动？" message="关闭后，本次修改的配置不会保存。"
          confirmLabel="放弃改动" danger
          onConfirm={() => { setConfirmClose(false); onClose(); }}
          onCancel={() => setConfirmClose(false)} />
      )}
    </>
  );
}
