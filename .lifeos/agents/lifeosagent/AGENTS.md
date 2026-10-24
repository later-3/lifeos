# Agent 本身

这里是一个 Agent 自己的配置与能力，**不属于协作层级**（协议 §4.1）。

- `agent.json`：身份与默认值（唯一来源）；
- `identity.md`：身份正文；
- `tools/`：该 Agent 独有的工具；
- `memory/`：该 Agent 的记忆（跨项目）；
- `projects/<项目 id>/`：该 Agent 在各项目下的空间；默认项目叫 `workspace`。

Agent 本身不设飞轮和案例；它的经验放在它的默认 workspace 下。
