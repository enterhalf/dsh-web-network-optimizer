# dsh-web-network-optimizer（Web 网络优化器）

**网页端加速并节约流量**——并附带移动端僵尸连接自动守护。

不做懒加载、不改业务代码，把传输、缓存、连接保活三件事做对：

1. **传输压缩**——所有可压缩响应下发 brotli（兜底 gzip），本地回环与远程访问一致；
2. **浏览器缓存**——内容哈希资源（`/assets/*`、`/plugins/*`、`rev=` URL、favicon）下发 `Cache-Control: public, max-age=31536000, immutable`；
3. **连接守护**——移动端切后台后网络被静默切断导致的"界面永久卡死"，自动检测并在 1 秒内恢复，全程不刷新页面。

外加一个**分插件流量账本**：设置 → **Web 网络优化器** 面板，实时看到每个插件本次加载与累计占用多少流量、压缩省了多少、缓存命中情况。

## 实测效果（完整加载 GUI，87 个静态请求）

| | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 静态资源线上流量 | 8.1 MB（无压缩、无缓存） | **1.54 MB** | **-81%** |
| 二次进入（缓存命中后） | 8.1 MB | **≈ 0**（只剩 API 数据） | 静态零传输 |
| 最大 API `/api/session.list` | 2.18 MB | **144 KB** | -93% |

> 注：优化前若还装有大体积插件（如 22.4MB 的 office 插件），首屏可达 30.5 MB——那部分是插件本身的问题；本插件解决的是"传输与缓存"这一层，两者叠加后提速最明显。

压缩与 dsh-remote 自带的 gzip 互不冲突：谁先压缩，另一个检测到 `content-encoding` 后自动跳过，装配顺序无关、不会双重压缩。

## 连接守护：解决移动端"永久卡死"

### 问题

手机切到后台后，运营商往往**静默切断 TCP**（不送 RST/FIN）；浏览器被冻结，收不到 `close` 事件。WebSocket 状态永远停在 `OPEN`，DSH 的连接控制器认为连接健康、永不重连。回到前台后：

- 界面看起来还"活着"，但所有实时事件（消息、状态）全部断流；
- 你无法分辨**"它没在动"**还是**"我网络断了"**。

### 原理

被动等待 `close` 永远等不到，所以改用**主动探针**。页面回前台时（以及每 30 秒心跳），跑三层检测：

1. `navigator.onLine === false` → 直接判离线（只信 false）；
2. 一次 `host.describe` unary 请求（4.5s 超时）→ 通不通网；
3. 自建一条到 `/api/events.mux` 的 WebSocket 握手（4.5s）→ 长连接通道能不能建。

**僵尸判定**：第 2、3 层都通（说明网络和服务端都活着），而连接控制器自认"已连接"，且页面曾在后台停留 ≥8 秒——那么控制器手里那条旧 WebSocket 几乎必然是被静默切断的死连接。

**恢复**：调用本插件的 `POST /web-network-optimizer/kick` 端点，服务端销毁 `webServer.upgradedSockets` 里**全部** upgrade socket。控制器的读取循环立刻收到 1006，走既有的指数退避重连，运行时随重连自动拉取会话/工作区做全量重同步。全程**不刷新页面**——草稿、滚动位置、输入中的一切内存状态完整保留，体感就是"卡住的界面自己活了"。

设计取舍：kick 对健康连接也是安全的（约 1 秒重连 + 重同步），所以判定宁可多 kick 一次、也不误放一条死连接。

### 你看到什么

界面右上角常显一枚小徽章：

| 状态 | 含义 |
|---|---|
| 🟢 连接正常 | 心跳探针通过 |
| 检查中… / 重连中… | 正在探测或控制器重连 |
| 离线 · 等待网络 | `navigator.onLine` 为 false |
| 网络异常 · 自动检测中 | unary/握手探针失败，每 5s 自愈重试 |
| 僵尸连接 · 正在恢复… | 已执行 kick，等待重连落地 |
| 已恢复 ✓ | 重连完成，5 秒后回到"连接正常" |

**点击徽章 = 手动强制重连**（绕过自动 kick 冷却）——任何时候怀疑它卡了，点一下就有确定的结果。

## 插件更新 / 卸载时的缓存语义

资源 URL 带内容哈希 `rev=`：

- **更新**：内容变化 → 新 rev → 新 URL，旧缓存自然失效；
- **卸载**：无人引用，孤儿缓存由浏览器自身配额回收，无需插件清理。

## 安装

**方式一：dsh-market 一键安装**——收录于 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 精选列表后，打开 设置 → 插件市场，搜索 `dsh-web-network-optimizer` 点装（npm 通道，秒级）。

**方式二：npm**（已发布后）：

```bash
dsh plugin --profile web add dsh-web-network-optimizer
```

**方式三：本地目录**（从 [GitHub Release](https://github.com/enterhalf/dsh-web-network-optimizer/releases) 下载 tgz 或克隆仓库）：

```bash
bash scripts/build.sh && node scripts/build-client.mjs   # 产出 lib/（Release 附件已含 lib/）
dsh plugin --profile web add /path/to/dsh-web-network-optimizer
```

卸载：

```bash
dsh plugin --profile web remove dsh-web-network-optimizer
```

卸载时路由包装完整还原（`webServer.register`、exact/prefixes/fallback 表、升级器），账本文件保留在 `~/.dsh/storages/dsh-web-network-optimizer/` 供回看。

## 工作原理（传输与缓存）

- 通过包装 `webServer.register` 与现有路由表（exact / prefixes / fallback / upgrades），对**所有**经过 webServer 的响应做透明测量与压缩；
- 压缩决策：`Accept-Encoding` 含 `br` 优先 brotli（quality 5），否则 gzip（level 6）；小于 512 B、SSE、已有 `content-encoding`、不可压缩类型一律跳过；
- 账本持久化于 `~/.dsh/storages/dsh-web-network-optimizer/ledger.json`（原子写、键上限 400 收敛为长尾、14 天趋势），按插件/核心前端/API 端点分桶；
- 设置页面板注册于 `settings.section` 槽位，5 秒轮询账本 API（`GET /web-network-optimizer/ledger`、`POST /web-network-optimizer/reset`），kick 走 `POST /web-network-optimizer/kick`，均在认证之后。

## 开发

```bash
bash scripts/build.sh            # 校验并产出 lib/index.js
node scripts/build-client.mjs    # 校验并产出 lib/client.js
```

## License

BSD-3-Clause
