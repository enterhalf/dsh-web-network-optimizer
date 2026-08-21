# dsh-web-optimizer（Web 优化器）

**极大提升 DSH Web GUI 的加载速度。**

不做懒加载、不改业务代码，只把两件事做对，首屏加载流量与等待时间随之坍缩：

1. **传输压缩**——所有可压缩响应下发 brotli（兜底 gzip），本地回环与远程访问一致；
2. **浏览器缓存**——内容哈希资源（`/assets/*`、`/plugins/*`、`rev=` URL、favicon）下发 `Cache-Control: public, max-age=31536000, immutable`。

外加一个**分插件流量账本**：设置 → **Web 优化器** 面板，实时看到每个插件本次加载与累计占用多少流量、压缩省了多少、缓存命中情况。

## 实测效果（完整加载 GUI，87 个静态请求）

| | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 静态资源线上流量 | 8.1 MB（无压缩、无缓存） | **1.54 MB** | **-81%** |
| 二次进入（缓存命中后） | 8.1 MB | **≈ 0**（只剩 API 数据） | 静态零传输 |
| 最大 API `/api/session.list` | 2.18 MB | **144 KB** | -93% |

> 注：优化前若还装有大体积插件（如 22.4MB 的 office 插件），首屏可达 30.5 MB——那部分是插件本身的问题；本插件解决的是"传输与缓存"这一层，两者叠加后提速最明显。

压缩与 dsh-remote 自带的 gzip 互不冲突：谁先压缩，另一个检测到 `content-encoding` 后自动跳过，装配顺序无关、不会双重压缩。

## 插件更新 / 卸载时的缓存语义

资源 URL 带内容哈希 `rev=`：

- **更新**：内容变化 → 新 rev → 新 URL，旧缓存自然失效；
- **卸载**：无人引用，孤儿缓存由浏览器自身配额回收，无需插件清理。

## 安装

从 GitHub Release 安装（tgz 附件）：

```bash
dsh plugin --profile web add https://github.com/TomIsFat/dsh-web-optimizer/releases/download/v0.1.0/dsh-web-optimizer-0.1.0.tgz
```

或本地构建后安装：

```bash
bash scripts/build.sh && node scripts/build-client.mjs   # 产出 lib/
dsh plugin --profile web add /path/to/dsh-web-optimizer
```

卸载：

```bash
dsh plugin --profile web remove dsh-web-optimizer
```

卸载时路由包装完整还原（`webServer.register`、exact/prefixes/fallback 表、升级器），账本文件保留在 `~/.dsh/storages/dsh-web-optimizer/` 供回看。

## 工作原理

- 通过包装 `webServer.register` 与现有路由表（exact / prefixes / fallback / upgrades），对**所有**经过 webServer 的响应做透明测量与压缩；
- 压缩决策：`Accept-Encoding` 含 `br` 优先 brotli（quality 5），否则 gzip（level 6）；小于 512 B、SSE、已有 `content-encoding`、不可压缩类型一律跳过；
- 账本持久化于 `~/.dsh/storages/dsh-web-optimizer/ledger.json`（原子写、键上限 400 收敛为长尾、14 天趋势），按插件/核心前端/API 端点分桶；
- 设置页面板注册于 `settings.section` 槽位，5 秒轮询账本 API（`GET /web-optimizer/ledger`、`POST /web-optimizer/reset`），两者均在认证之后。

## 开发

```bash
bash scripts/build.sh            # 校验并产出 lib/index.js
node scripts/build-client.mjs    # 校验并产出 lib/client.js
```

## License

BSD-3-Clause
