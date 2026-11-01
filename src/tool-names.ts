// Life OS 自有工具名（唯一清单）。
//
// 独立成模块避免循环依赖：agent-tools 定义工具（会 import peer），而 peer/agent-host 只关心"有哪些名字"。
// 与内置 8 工具一起显式钉进 allowlist，见 agent-host.ts · ALL_TOOL_NAMES。
export const LIFEOS_TOOL_NAMES = [
  "lifeos_agent_create", "lifeos_agent_delete",
  "lifeos_task_create", "lifeos_task_list", "lifeos_task_enter",
  "lifeos_project_add", "lifeos_project_remove", "lifeos_project_list",
  "lifeos_memory_search", "lifeos_memory_record", "lifeos_memory_delete",
  "lifeos_ask", "lifeos_send",
] as const;
