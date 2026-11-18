# ScaraIM

**v0.1.0 · 首个功能版本**

[下载源码](https://github.com/scaraOvO/ScaraIM/releases) · [问题反馈](https://github.com/scaraOvO/ScaraIM/issues) · [更新记录](CHANGELOG.md)

React + TypeScript 前端，Rust / Axum 后端，SQLite 数据库。中文界面支持桌面三栏布局和手机单栏切换。本项目运行在本机，不依赖外部 IM、数据库、Redis 或对象存储服务。

## 技术栈

| 层级 | 实现 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Lucide 图标、CSS 动画与响应式布局 |
| 后端 | Rust 2021、Axum 0.8、Tokio 异步运行时 |
| 数据 | SQLx + SQLite；附件保存在本地数据目录 |
| 实时通信 | WebSocket 收发消息、在线状态、已读通知、命令结果；HTTP 加载历史和上传/下载文件 |
| 认证 | Argon2 密码哈希、HttpOnly / SameSite Cookie 会话 |
| 运维 | sysinfo 系统指标、crossterm TUI、日志轮换、管理操作审计 |
| 扩展 | Rust CommandPlugin 接口和受限 JSON 声明式命令插件 |

界面支持简体中文、繁体中文、英文、日文。头像采用柔和阴影；消息与弹窗使用短过渡动画，并尊重系统“减少动态效果”设置。

## 获取与快速启动

```sh
git clone https://github.com/scaraOvO/ScaraIM.git
cd ScaraIM
```

安装下表所列环境，运行对应启动脚本，然后打开 **http://127.0.0.1:3001**。首次使用先注册账号；需要管理员时按下文执行 `--set-admin 用户名`。首版发布提供源码，在目标平台编译运行。

## Windows / Linux / macOS

所有命令均以仓库根目录为起点（注明 backend 目录的除外）。无需安装数据库服务。

| 系统 | 编译环境 | 启动 |
| --- | --- | --- |
| Windows | Rust stable、Node.js 22.12+、Visual Studio C++ Build Tools / Windows SDK | `./start.ps1`（PowerShell） |
| Linux | Rust stable、Node.js 22.12+、C/C++ 编译器、pkg-config、OpenSSL 开发包 | `bash start.sh` |
| macOS | Rust stable、Node.js 22.12+、Xcode Command Line Tools | `bash start.sh` |

Ubuntu/Debian 的编译依赖可安装 `build-essential pkg-config libssl-dev`；macOS 可执行 `xcode-select --install`。Rust、Node.js 需提前装好并加入 PATH。前端依赖首次安装及 Rust 首次编译需要联网。

Linux/macOS 的终端界面使用 `bash start.sh --tui`。无交互终端（重定向输出、服务进程）时，即使指定 `--tui` 也自动使用普通日志模式。Unix 支持 SIGTERM，普通终端支持 Ctrl+C；TUI 中先 Esc 退出界面再 Ctrl+C 停止服务。

### Rust 原生命令设置管理员

先注册目标账号。在 `backend` 目录运行，三平台通用：

```sh
cargo run --locked -- --set-admin alice
```

已编译程序可直接执行（Windows 文件名为 `scaraim.exe`）：

```sh
./target/debug/scaraim --set-admin alice
./target/debug/scaraim --command "/setadmin alice"
```

运行中的 TUI 输入 `/setadmin alice` 也可授权。这里的 `alice` 是已有账号的登录用户名，不是昵称或用户 ID；命令将该账号设为管理员，不改名、不创建默认密码，也不撤销其他管理员。被封禁账号会同时解封。用户名不区分大小写，不存在则报错并返回非零退出码。客户端无法执行这个本机专用命令。授权后刷新网页即可进入管理后台。

快捷脚本：Windows `./grant-admin.ps1 -Username alice`；Linux/macOS `bash grant-admin.sh alice`。

### 数据目录与部署

直接运行二进制时，默认数据目录为当前工作目录的 `data`，默认前端为 `../frontend/dist`，保持旧版兼容。启动脚本固定从 backend 运行，因此原有 `backend/data` 会继续使用。换目录运行或部署为服务时，请显式指定绝对路径：

```sh
scaraim --data-dir "/srv/scaraim/data" --frontend-dir "/srv/scaraim/frontend/dist" --bind "127.0.0.1:3001"
scaraim --data-dir "/srv/scaraim/data" --set-admin alice
```

Windows 同样支持如 `--data-dir "D:\ScaraIM 数据"` 的路径。数据库、附件、日志和插件均统一存放在指定数据目录中，路径支持中文和空格。设置管理员时必须指定与服务相同的数据目录。

可用环境变量 `SCARAIM_DATA_DIR`、`FRONTEND_DIR`、`BIND_ADDR` 配置；命令行参数优先。`--help` 查看完整参数，`--version` 查看版本。生产部署可使用 `cargo build --release --locked`，复制对应平台的二进制和 `frontend/dist`；Windows、Linux、macOS 的二进制需分别构建，不能互换。迁移数据时先停止服务，再复制完整数据目录。

`.github/workflows/check.yml` 配置 Windows、Linux、macOS 的前端构建、Rust 构建和回归检查；将本目录作为仓库根目录上传后可运行。当前本机验证范围为 Windows，未声称 Linux/macOS 已实机通过。

新增跨平台验证：`node scripts/platform-checks.mjs`，覆盖参数错误、管理员授权、中文/空格数据路径、静态页面和无终端运行。与 `node scripts/integration.mjs` 一样，可通过 `IM_TEST_BINARY` 指定待测二进制。

## 管理后台、多语言与命令

- 管理员在左侧盾牌图标进入后台，也可打开 `/#admin`。后台提供系统概览、用户管理、徽章管理、日志与审计。普通账号无法调用管理接口。
- 系统概览显示 OS、架构、CPU 型号/核心/使用率、内存、运行时间、在线连接、用户及消息数量、SQLite/WAL/附件实际磁盘占用。消息正文大小与完整数据库大小分别统计。监控每 5 秒刷新，聊天仍使用 WebSocket。
- 可创建/编辑用户资料和密码、设置管理员角色、封禁/解封、撤销会话、删除用户。不能删除或降级自己。重置密码/封禁会使已有会话失效。
- 删除用户会永久删除该用户及其双方聊天记录、好友关系与徽章授予；已被转发的文件可能仍被其他用户引用，因此不自动删除磁盘附件。
- 用户消息可导出 JSON，服务端按每批 500 条流式读取。导出只包含该用户参与的消息，包含文件 ID，不嵌入附件二进制；记录导出开始时的消息上界，新消息不混入本次导出。
- 徽章 ID 创建后固定，名称与图案可编辑；支持 PNG/JPEG/GIF/WebP，最大 20 MB。支持发放、收回、删除徽章，普通用户不能自行授予。
- 管理操作写入 SQLite 审计表；运行日志保存在 `backend/data/server.log`，10 MiB 轮换为 `server.previous.log`。日志不记录消息正文、密码或 Cookie。
- 用户页提供中国、台湾、美国、日本国旗按钮，切换简体中文、繁体中文、英文、日文，选择保存在本机浏览器。用户昵称、消息和自定义徽章名称保持原文。

### 首个管理员

没有默认管理员密码，也不会自动把第一个注册用户设为管理员。先在网页注册账号，然后在项目根目录执行：

```powershell
.\grant-admin.ps1 -Username 你的用户名
```

刷新页面后出现盾牌入口。之后可在后台给其他账号授予管理员角色。本机授权命令需要服务器电脑的操作权限。

### TUI 与命令

```powershell
.\start.ps1 -Tui
```

如果后台服务已经占用 3001，先停止原服务，再启动 TUI 版；二者是同一个后端进程的运行模式。TUI 显示实时日志、CPU/内存与连接数，下方输入命令。↑/↓ 浏览命令历史，PgUp/PgDn 翻看日志，Esc 退出 TUI（服务继续运行），之后 Ctrl+C 停止服务。

在当前聊天框输入 `/ping`、`/sysinfo`、`/help` 后发送，结果直接显示在当前聊天时间线中，仅自己可见，不发送给好友、不写入服务器聊天历史。结果最多保留最近 100 条，刷新或退出登录后清除。消息以 `//` 开头时会转为单个 `/`，用于发送字面斜杠文本。`/ping` 显示客户端测得的往返延迟。

管理员还可使用 `/stats`、`/users`、`/ban 用户ID`、`/unban 用户ID`、`/revoke-sessions 用户ID`。`/setadmin 用户名`（兼容 `/grantadmin 用户名`）仅限本机控制台。命令不执行 Shell。脚本方式可在 backend 目录执行 `scaraim.exe --command "/sysinfo"`。

### 插件扩展

`backend/src/commands.rs` 定义 CommandPlugin、Context、CommandFuture，所有 WebSocket 与本机命令共用分发层。Rust 功能插件可实现接口后在启动注册，默认有 5 秒超时，服务端检查管理员权限。

同时支持声明式 JSON 插件：将 `plugins/example.json` 复制到 `backend/data/plugins/`，重启后 `/about` 即可用。声明式插件只返回配置中的 JSON，不执行脚本。命令名重复、覆盖内置命令、超出 64 KiB 的清单会被拒绝。

## 已实现

- 用户注册、登录、退出；用户名、密码、UUID 用户 ID、昵称、头像、横幅、在线状态和系统徽章。
- 搜索用户（用户名 / ID / 昵称）、添加和删除双向好友、修改仅自己可见的好友备注、查询好友。
- 私聊文字、图片、任意文件（单个最大 20 MB）、转发文字和附件。
- 会话列表、未读计数、已读状态、消息持久化、每页 100 条历史记录、加载更早消息。
- 资料编辑、图片预览、文件下载、移动端适配、断线重试提示。

## 环境

- Node.js 22.12+。
- Rust stable 和 Cargo。
- Windows 需要 Visual Studio C++ Build Tools / MSVC 和 Windows SDK（脚本会加载编译环境）。
- SQLite 自动创建，无需单独安装。

## 一键启动（Windows PowerShell）

进入本文件所在的 `im` 文件夹，运行：

```powershell
.\start.ps1
```

首次启动会下载依赖、构建前端并编译后端。看到 `ScaraIM: http://127.0.0.1:3001` 后打开该网址。保持终端运行；按 Ctrl+C 停止。

启动后没有预设账号。用普通浏览器和隐私窗口各注册一个账号，搜索对方用户名并添加好友，即可测试双向聊天。两个普通标签页共享同一登录会话，不适合模拟不同用户。

如果只想启动已经编译好的版本：

```powershell
cd backend
.\target\debug\scaraim.exe
```

## 开发

后端（项目根目录执行）：

```powershell
. .\scripts\rust-env.ps1
cd backend
cargo run --locked
```

前端（另一个终端）：

```powershell
cd frontend
npm ci
npm run dev
```

前端开发地址为 http://127.0.0.1:5173，`/api` 自动代理到后端 3001。正式构建由 Rust 直接托管，不需要另开前端服务。

## 验证

```powershell
cd frontend
npm run build
cd ..
node scripts/integration.mjs
```

测试需先编译后端。脚本在 `.cache/integration-*` 创建独立数据库，使用 3109 端口，结束后停止测试服务器，不修改正式数据库。测试覆盖 65 项检查，包括错误密码、未登录请求、备注隔离、附件越权、转发附件、分页、删除好友后禁止发消息和重新登录。开发时已通过前端构建、Rust 编译及全部 65 项测试。

## 数据与配置

从 `backend` 目录启动时：

- `backend/data/im.db`：用户、好友、会话与文件元数据。
- `backend/data/uploads/`：上传内容，以随机 ID 命名。
- 备份时停止服务，再复制整个 `backend/data` 文件夹；恢复时完整还原。
- `BIND_ADDR`：默认 `127.0.0.1:3001`。
- `FRONTEND_DIR`：默认 `../frontend/dist`，可设置为前端构建目录绝对路径。
- `COOKIE_SECURE=1`：部署到 HTTPS 环境时启用 Secure Cookie。

## 第一版行为约定

- 添加好友直接建立双向关系；没有好友申请与审核流程。
- 删除好友会同时解除双方关系，保留历史消息；重新添加后可以继续查看。
- 消息收发、转发、已读通知和资料/好友变化通知通过同源 `/api/ws` WebSocket 传递，不再每 2 秒轮询。历史记录和文件上传/下载继续使用 HTTP；好友列表在收到变化通知后按需获取。
- WebSocket 自动重连，重试间隔 1、2、4、8 秒，最高 15 秒；连接恢复后重新获取好友列表和当前会话最近 100 条记录，更早消息仍可分页加载。服务器每 15 秒发送心跳，45 秒无响应断开；在线状态按实际连接数计算，关闭同一用户的一个窗口不会使其他窗口离线。
- 发送需等待服务器确认后清空输入；未确认的消息不会自动重发，避免重连造成重复。若提示结果未知，请检查恢复后的记录再决定是否重发。
- 保留系统初始徽章“初来乍到”；管理员可创建带自定义 ID、名称和图片的徽章，并发放或收回。
- 密码使用 Argon2 加盐哈希；会话使用随机、不含个人数据的 HttpOnly Cookie，7 天有效；退出会使当前会话失效。
- 文件只有上传者、消息参与者及有效转发接收者可访问。头像与横幅可由登录用户查看。HTML/SVG 等文件不会作为站内网页内联执行。
- 当前适合本机或小规模试用。公网部署需配 HTTPS 反向代理、上传配额、注册限流与备份策略；未实现端到端加密、病毒扫描、集群部署。

## API

管理员路由位于 `/api/admin/`，提供 stats、logs、users、badges，以及用户的 export、sessions、badges 子资源。`GET /api/commands` 返回当前用户有权调用的命令。

所有身份凭据由同源 Cookie 携带，错误响应为 `{"error":"说明"}`。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| `/api/ws` | WebSocket | 同源 Cookie 鉴权后的实时连接 |
| `/api/register` | POST | 注册并登录 |
| `/api/login` / `/api/logout` | POST | 登录 / 退出 |
| `/api/me` | GET / PATCH | 获取身份、心跳 / 编辑资料 |
| `/api/users?q=...` | GET | 查找用户 |
| `/api/friends` | GET | 好友、最近消息、未读计数 |
| `/api/friends/{id}` | POST / DELETE / PATCH | 添加 / 删除 / 修改备注 |
| `/api/messages/{id}?before=消息ID` | GET | 与指定用户的聊天历史 |
| `/api/messages/{id}` | POST | 保留兼容接口；当前前端通过 WebSocket 发送 |
| `/api/messages/{id}/read` | POST | 标记该会话已读 |
| `/api/upload` | POST | multipart 文件上传 |
| `/api/files/{id}` | GET | 鉴权后获取文件 |

## WebSocket 协议

连接 `/api/ws`，沿用 HttpOnly 会话 Cookie，服务端校验 Origin 与 Host 一致。反向代理需要保留原始 Host，并转发 Upgrade / Connection 请求头；HTTPS 网站自动使用 WSS。

客户端发送示例：

```json
{"type":"send","request_id":"唯一请求标识","target":"好友ID","payload":{"body":"你好"}}
{"type":"read","request_id":"另一个标识","target":"好友ID"}
{"type":"pong"}
```

发送图片/文件时，先 HTTP 上传，再把 payload 改为 `{ "file_id": "上传返回的ID" }`。转发使用 `{ "forward_id": 123 }`。服务端发送 `ready`、`ping`、`ack`、`error`、`message`、`read`、`friends_changed` 事件。消息先写入 SQLite，再向参与双方的全部连接推送；发送、推送与心跳时均验证会话有效性。慢客户端队列溢出会断开并通过重连补载，不静默丢弃事件。


验收：前端 TypeScript/Vite 构建、Rust 编译、65 项自动测试通过；TUI 已在终端实际启动，执行 `/ping` 并记录 pong。管理员初始化需自行指定已有用户名。

## 服务器部署示例（Linux）

在目标服务器安装 Rust、Node.js 和系统编译依赖后：

```sh
cd frontend
npm ci
npm run build
cd ../backend
cargo build --release --locked
```

将 `backend/target/release/scaraim` 放到 `/srv/scaraim/scaraim`，将 `frontend/dist` 放到 `/srv/scaraim/frontend/dist`，为运行服务的非 root 用户创建可写的 `/srv/scaraim/data`。以该用户执行：

```sh
COOKIE_SECURE=1 /srv/scaraim/scaraim \
  --data-dir /srv/scaraim/data \
  --frontend-dir /srv/scaraim/frontend/dist \
  --bind 127.0.0.1:3001
```

此配置应通过 HTTPS 反向代理访问；纯本地 HTTP 调试不要启用 `COOKIE_SECURE=1`。反向代理需保留原始 Host 并支持 WebSocket Upgrade。可使用 Caddy，将以下域名替换为已指向服务器的实际域名：

```caddyfile
im.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Caddy 负责 HTTPS 和 WebSocket 转发；确保域名解析及 80/443 端口可达。也可用 Nginx，需显式设置 Upgrade/Connection、原始 Host，并把请求大小上限设为至少 21 MiB。不要将数据库或 uploads 目录直接映射为公开静态目录。

使用系统服务管理器运行上述进程并设置自动重启；服务启动参数需使用绝对路径，数据目录归服务用户所有。首次启动后网页注册，再用相同数据目录执行 `scaraim --data-dir /srv/scaraim/data --set-admin 用户名`。升级前停止服务并备份完整数据目录；替换二进制和前端文件后重新启动。

