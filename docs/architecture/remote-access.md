# 远程访问（Cloudflare Tunnel + Access）

> 角色：部署与访问架构　类型：架构　状态：现状（2026-10-21）
>
> 本文只写机制与公开访问方式；隧道 ID、凭据路径、Access 团队域与允许邮箱属于本机运维信息，不随仓库发布。

## 1 机制

Life OS 不在公网监听端口。远程访问由三段组成：

1. **本机进程**：后端监听 `127.0.0.1:43120`（`src/main.ts`），同时托管 `frontend/dist`；局域网地址不可直连。远程访问的是这个后端与已构建的 `frontend/dist`，不是本机前端开发用的 Vite `5173`。
2. **出站隧道**：Cloudflare Tunnel `lifeos-home` 由 macOS LaunchAgent 常驻，ingress 把 `lifeos.ai4child.asia` 转到 `http://127.0.0.1:43120`，其余请求返回 404。隧道只主动向 Cloudflare 边缘建立出站连接，不需要公网 IP、端口映射或改路由器。
3. **身份门**：Cloudflare Access 的自托管应用保护该 hostname，只允许指定邮箱，登录方式为 One-time PIN。未登录请求在边缘直接 302 到 Access 登录页，不会到达本机。

```text
浏览器
  → Cloudflare 边缘（TLS + Access）
  → Tunnel（出站连接）
  → cloudflared（Mac）
  → 127.0.0.1:43120（Hono + SSE）
  → 原路返回
```

关键顺序：**先建 Access 应用，再建 DNS**。反过来会有一段“域名可达但无身份门”的窗口。

## 2 公网访问方式

- 地址：`https://lifeos.ai4child.asia`
- 身份：使用 Access 策略允许的邮箱接收 One-time PIN，输入后进入；不需要 VPN 或客户端。
- 手机在蜂窝网下打开同一地址，走同一登录流程（待手机复测）。
- 局域网直连 `192.168.x.x:43120` 不可用，这是绑定 `127.0.0.1` 的预期结果。

## 3 进程与可用性

隧道指向的是 Mac 上的**开发进程**，不是生产服务（方案 B）：

- 需要 Mac 开机在线；
- 需要后端进程在跑（`pnpm dev` 或 `pnpm dev:all`）；
- 需要 LaunchAgent 的 `cloudflared` 在跑。

任一条件不满足时，Access 登录仍可能成功，但源端会返回 502。Mac 睡眠、关终端或重启后远程不可用。

## 4 边界与已知限制

- **应用本身仍无登录、无多用户**（见 [`foundation.md`](./foundation.md) §9）；Access 是唯一的身份门，不能绕过它单独建 DNS。
- Access 会话过期后，页面内 API 请求会被重定向到登录页；刷新重新登录。
- 当前未做生产级常驻：隧道常驻，但 Life OS 进程依赖开发命令。
- 不复用 Chat 或其他服务器的隧道与配置；`lifeos-home` 有独立生命周期。

## 5 验证

| 检查 | 命令 | 预期 |
|---|---|---|
| 隧道连接 | `cloudflared tunnel info lifeos-home` | 至少 1 条活动连接 |
| DNS | `dig +short lifeos.ai4child.asia` | Cloudflare `104./172.67` 段 |
| 身份门 | `curl -sI https://lifeos.ai4child.asia` | 302 到 `*.cloudflareaccess.com` |
| 本机 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:43120/api/agents` | 200 |
| 登录后 | 浏览器完成邮箱 OTP | 页面、Agent 列表、SSE 正常（待验收） |

## 6 从零搭建（脱敏）

> 具体隧道 ID、凭据路径、Access 团队域与允许邮箱不在仓库中；它们存放在本机项目共享层，不随仓库发布。

1. **先建身份门**：Zero Trust → Access → Applications → Add an application → Self-hosted。Public hostname 填 `<subdomain>.<domain>`，Path 留空；策略 `Allow` + `Include → Emails → <allowed-email>`；登录方式 One-time PIN；保存。此时先不建 DNS。
2. **建隧道**：`cloudflared tunnel create <tunnel-name>`，记下 UUID；配置文件：

   ```yaml
   tunnel: <uuid>
   credentials-file: <credentials-path>
   ingress:
     - hostname: <subdomain>.<domain>
       service: http://127.0.0.1:<port>
     - service: http_status:404
   ```

   凭据文件权限设为 `600`。
3. **常驻运行**：macOS 用 LaunchAgent（`RunAtLoad` + `KeepAlive`），Linux 用 systemd user service；先确认 `cloudflared tunnel info <tunnel-name>` 有活动连接。
4. **最后建 DNS**：`cloudflared tunnel route dns <tunnel-name> <subdomain>.<domain>`。
5. **验收**：`dig` 解析到 Cloudflare 段；未登录 `curl -I` 返回 302 到 `*.cloudflareaccess.com`；本机 `curl` 返回 200；浏览器完成 OTP 后页面与 SSE 正常。

若 Access 后台要求 hostname 已有 DNS：先把 ingress 指向 `http_status:404`，建 DNS，再建 Access 应用，最后把 ingress 切回源端。

## 7 日常维护

| 变更/故障 | 做法 |
|---|---|
| 源端端口变化 | 改 config 的 ingress → 重启常驻进程 |
| 前端更新 | `pnpm build` 更新 `frontend/dist`；远程不走 Vite `5173` |
| 隧道断线 | `cloudflared tunnel info <tunnel-name>`、常驻状态、stderr 日志 |
| 登录成功但 502 | 源端进程没跑 |
| 改允许邮箱/会话时长 | Zero Trust 控制台改 Access 应用 |
| 回滚 | 停常驻 → 删 DNS → 删隧道 → 删 Access 应用 |

### 迁移到常驻服务器

域名、Access 应用、策略、邮箱和手机书签都不随宿主变化，差别只在隧道连接器：

- **复用同一隧道**：把凭据与 config 放到服务器，启动 connector，并**停掉 Mac 上的 connector**；同一隧道多个 connector 会把流量分到旧源端。CF 不需要操作，DNS 也不变。
- **新建隧道，或复用服务器上已有的隧道**：只需要把 `lifeos.ai4child.asia` 的 DNS CNAME 指到新隧道；Access 应用不动。
- ingress 指向新宿主的 `127.0.0.1:<port>`；端口不同只改本地 config。凭据保持 `600`，不进仓库。

## 8 相关

- 应用边界：[`foundation.md`](./foundation.md) §9（不做登录、不多用户）。
- 选型参考：[`../standards/reference-baseline.md`](../standards/reference-baseline.md) 的「远程访问」场景行。
- 本机运维细节（隧道 ID、配置与凭据路径、Access 团队域、重启/回滚命令）单独存档，不进入仓库。
