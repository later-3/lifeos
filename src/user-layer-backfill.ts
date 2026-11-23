/**
 * 用户层的一次性回填（Task 0035 · S1.5 地基）。
 *
 * 为什么需要它、而不是只靠"注册路径"自愈：`ensureUserProjectLayer` 只在**新注册**全局项目时被调
 * （`registerGlobalProject`）。存量项目早就在 `projects/registry.json` / `projects/<pid>/` 里了，
 * 不会再走一次注册 —— 于是 `users/<uid>/projects/` 永远缺那几份。**不做回填，验收句 2 永远不成立**。
 *
 * 为什么放在启动时、不用迁移文件：本项目的既有先例是 `src/main.ts` 里 `ensureMediaDir(home)` 那种
 * "启动补齐、create-only、已存在不覆盖"。一次性迁移文件（`migrations/*.json`）是给**会动既有数据**
 * 的迁移用的；这里只新建目录，create-only 本身幂等，写迁移文件反而多一份状态要维护。
 *
 * 失败不阻断启动（与 `ensureUserProjectLayerSafely` 同一个理由）：用户层是"顺带的结构"，
 * 它坏了不该让后端起不来。失败留一条 `warn` 日志，`home:check` 会把缺口报出来。
 */
import { log } from "./logging.ts";
import { listGlobalProjects } from "./project-registry.ts";
import { existingUserId, userDirOf, userProjectDirOf } from "./profile.ts";
import { ensureUserLayer, ensureUserProjectLayer } from "./project-skeleton.ts";

export async function backfillUserLayer(home: string): Promise<{ uid: string; projects: number } | undefined> {
  try {
    // 没有真实实体（`users/<uid>/user.json`）就不回填：结构是"用户的空间"，不是"预设一个用户"
    const uid = await existingUserId(home);
    if (uid === undefined) return undefined;
    // 用户层根 + AGENTS.md（create-only：用户自己写的说明不会被覆盖）
    await ensureUserLayer(userDirOf(home, uid));
    let projects = 0;
    for (const project of (await listGlobalProjects()).values()) {
      await ensureUserProjectLayer(userProjectDirOf(home, uid, project.id));
      projects += 1;
    }
    return { uid, projects };
  } catch (error) {
    void log.warn("registry", "backfillUserLayer", "用户层回填失败（不影响启动；home:check 会报）", {
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    return undefined;
  }
}
