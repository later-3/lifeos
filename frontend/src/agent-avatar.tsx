/** 头像：图片优先，否则 id 推导色阶 + 首字母（列表与配置面板共用）。 */
import { avatarBoxStyle } from "./avatar-style";

export type AgentAvatarSpec = { kind?: string; file?: string; revision?: number };

/**
 * 头像底色（按 id 派生，同一个助手永远同色）。
 *
 * **不能用 `ink-700` / `ink-900`**（2026-11-09 视觉矩阵抓到的缺陷）：
 * 这两个 token 在深色模式下是**近白**（L\*82 / L\*96），而首字母固定用白字
 * → 深色下变成"白底白字"，头像只剩一个空白圆（矩阵图 chat-dark-1280 一眼可见）。
 *
 * 换成语义色后深浅两侧都成立：accent-solid / success / danger / running 都是
 * "深底 + 白字"（它们本身就是为白字设计的，见 theme.ts 的 accentSolid 说明）。
 */
const AVATAR_TONES = ["bg-avatar-1", "bg-avatar-2", "bg-avatar-3"];

export function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

export function AgentAvatar({ id, name, avatar, size = 24, className = "" }: {
  id: string; name: string; avatar?: AgentAvatarSpec; size?: number; className?: string;
}) {
  const style = avatarBoxStyle(size);   // 尺寸与首字母字号唯一实现在 avatar-style.ts
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
