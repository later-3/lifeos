// Agent 头像写入（唯一实现）：HTTP 上传与 `lifeos_media_avatar_set` 都调这里。
//
// 为什么单独成模块（`specs/code/backend/code.md` 2.6「业务动作只在共享模块，工具与 HTTP 都是外壳」）：
// 头像写入牵三件事——落文件、改 agent.json、广播；任何一条漏掉都会让界面停在旧状态
// （2026-11-12 实测：漏 broadcast → 用户每次都要手动刷新才能看到新头像，见 Task 0016 案例）。

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readAgent, writeAgent, type AgentDefinition } from "./agents.ts";
import { broadcast } from "./events.ts";
import { resolveHome } from "./home.ts";
import { sniffMediaImage } from "./media.ts";

/** Agent 头像允许的最大字节（与用户头像 1MB 不同：Agent 头像走 512px 缩略图，2MB 足够）。 */
export const MAX_AGENT_AVATAR_BYTES = 2 * 1024 * 1024;

export type SetAvatarResult =
  | { ok: true; avatar: { kind: "image"; file: string; revision: number } }
  | { ok: false; code: "agent_not_found" | "image_too_large" | "invalid_image"; message: string; status: 400 | 404 };

/**
 * 写入 Agent 头像（覆盖旧图）。
 *
 * 失败语义：Agent 不存在 → 404；图片过大 → 400；格式不认（魔数嗅探）→ 400。
 * 成功时：文件 0600 落 `agents/<id>/avatar/avatar.<ext>`，agent.json 记 `{kind,file,revision}`，
 * 然后广播 `agents_changed`（前端 img src 带 `?v=revision`，revision 变即换图）。
 */
export async function setAgentAvatar(agentId: string, buffer: Buffer): Promise<SetAvatarResult> {
  const agent = await readAgent(agentId);
  if (agent === undefined) {
    return { ok: false, code: "agent_not_found", message: `找不到 Agent：${agentId}`, status: 404 };
  }
  if (buffer.length > MAX_AGENT_AVATAR_BYTES) {
    return { ok: false, code: "image_too_large", message: `头像不能超过 ${MAX_AGENT_AVATAR_BYTES / (1024 * 1024)}MB`, status: 400 };
  }
  const sniffed = sniffMediaImage(buffer);
  if (sniffed === undefined) {
    return { ok: false, code: "invalid_image", message: "仅支持 png/jpg/webp", status: 400 };
  }
  const avatarDir = join(resolveHome(), "agents", agent.id, "avatar");
  await mkdir(avatarDir, { recursive: true, mode: 0o700 });
  // 先清空再写：换格式（png → webp）时不留旧文件，目录里永远只有一张当前头像
  await rm(avatarDir, { recursive: true, force: true });
  await mkdir(avatarDir, { recursive: true, mode: 0o700 });
  const file = `avatar.${sniffed.ext}`;
  await writeFile(join(avatarDir, file), buffer, { mode: 0o600 });
  const avatar = { kind: "image" as const, file, revision: Date.now() };
  await writeAgent({ ...agent, avatar } as AgentDefinition);
  broadcast({ type: "agents_changed" });
  return { ok: true, avatar };
}

export type ClearAvatarResult =
  | { ok: true }
  | { ok: false; code: "agent_not_found"; message: string; status: 404 };

/** 清掉头像（回到首字母色块）。同样要广播：否则界面还显示旧图。 */
export async function clearAgentAvatar(agentId: string): Promise<ClearAvatarResult> {
  const agent = await readAgent(agentId);
  if (agent === undefined) {
    return { ok: false, code: "agent_not_found", message: `找不到 Agent：${agentId}`, status: 404 };
  }
  await rm(join(resolveHome(), "agents", agent.id, "avatar"), { recursive: true, force: true });
  const updated = { ...agent } as AgentDefinition & { avatar?: unknown };
  delete updated.avatar;
  await writeAgent(updated as AgentDefinition);
  broadcast({ type: "agents_changed" });
  return { ok: true };
}
