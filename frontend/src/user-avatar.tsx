/**
 * 用户头像（= 你本人，2026-11-02 用户拍板："用户是我，不是 Agent"）。
 *
 * 与 `AgentAvatar` 的区别：
 * - Agent 有 `agent.json` 的 `avatar`，走 `/api/agents/<id>/avatar`；
 * - 用户走 `/api/profile/avatar`，档案在 `~/.lifeos/config/profile.json`。
 * 两者共用同一套视觉（圆形、尺寸、首字母色块），但**数据源严格分开**——不引入"用户 Agent"。
 */
import { useEffect, useState } from "react";
import { avatarBoxStyle } from "./avatar-style";

/**
 * 用户档案（Task 0015 · T9）：用户是**实体**，有 id。
 * 前端用 `id` 做 key（重名时区分）与无障碍标签，用 `name` 显示。
 */
export type UserProfile = { id: string; name: string; avatar: { file: string; revision: number } | null };

/** 用户头像的色块：固定用 accent（与 Agent 的 id 派生色区分开，一眼知道"这是我"）。 */
const USER_TONE = "bg-accent";

/**
 * 头像图片源。带 `revision` 破缓存：换头像后同一 URL 前缀也不会拿到旧图。
 * `revision` 是档案里存的时间戳，服务端 `no-store` 也不够——浏览器内存里的 <img> 仍会复用。
 */
export function profileAvatarSrc(avatar: { revision: number }): string {
  return `/api/profile/avatar?v=${avatar.revision}`;
}

export function UserAvatar({ profile, size = 24, className = "" }: {
  profile: UserProfile;
  /** 已算好的像素尺寸（调用方按字号缩放传入，见 display-prefs 的 avatarSizeOf） */
  size?: number;
  className?: string;
}) {
  const style = avatarBoxStyle(size);   // 尺寸与首字母字号唯一实现在 avatar-style.ts
  // 图片加载失败（文件被删/损坏）→ 回落到首字母，不显示破图标
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [profile.avatar?.revision]);
  if (profile.avatar !== null && !broken) {
    return (
      <img src={profileAvatarSrc(profile.avatar)} alt={profile.name} style={style}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover ${className}`} />
    );
  }
  return (
    <span style={style} aria-label={profile.name}
      className={`flex shrink-0 items-center justify-center rounded-full font-medium text-white ${USER_TONE} ${className}`}>
      {profile.name.slice(0, 1)}
    </span>
  );
}
