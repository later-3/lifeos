/** 头像：图片优先，否则 id 推导色阶 + 首字母（列表与配置面板共用）。 */

export type AgentAvatarSpec = { kind?: string; file?: string; revision?: number };

const AVATAR_TONES = ["bg-accent", "bg-ink-700", "bg-ink-900"];

export function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

export function AgentAvatar({ id, name, avatar, size = 24, className = "" }: {
  id: string; name: string; avatar?: AgentAvatarSpec; size?: number; className?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) };
  if (avatar?.kind === "image" && typeof avatar.file === "string") {
    return (
      <img src={`/api/agents/${id}/avatar?v=${avatar.revision ?? 0}`} alt={name} style={style}
        className={`shrink-0 rounded-full object-cover ${className}`} />
    );
  }
  return (
    <span style={style}
      className={`flex shrink-0 items-center justify-center rounded-full font-medium text-white ${avatarTone(id)} ${className}`}>
      {name.slice(0, 1)}
    </span>
  );
}
