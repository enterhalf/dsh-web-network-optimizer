# dsh-web-network-optimizer（Web 网络优化器）

**网页端加速并节约流量。** 不做懒加载、不改业务代码，把传输、缓存、连接保活三件事做对：

1. **响应压缩**——所有可压缩响应下发 brotli（不支持则 gzip），本地回环与远程访问行为一致；
2. **浏览器缓存**——内容哈希资源（`rev=` URL、`/assets/*`、favicon）下发 `Cache-Control: immutable`，二次访问近乎零传输；
3. **连接守护**——手机切后台后运营商静默断网导致的"界面永久卡死"，自动检测并在 1 秒内恢复，全程不刷新页面。

外加一个**分插件流量账本**：设置 → **Web 网络优化器** 面板，实时看到每个插件本次加载与累计占用多少流量、压缩省了多少、缓存命中情况。

## 实测效果

完整加载 GUI（87 个静态请求）：首屏静态流量 8.1 MB → **1.54 MB（−81%）**，缓存命中后二次访问静态零传输；最大 API `/api/session.list` 2.18 MB → **144 KB（−93%）**。

与 dsh-remote 自带的 gzip 互不冲突：谁先压缩，另一个检测到 `content-encoding` 后自动跳过，装配顺序无关、不会双重压缩。

## 连接守护

手机切到后台后，运营商往往**静默切断 TCP**（不送 RST/FIN）；浏览器被冻结，收不到 close 事件，WebSocket 状态永远停在 `OPEN`，连接控制器认为连接健康、永不重连。回到前台后：界面看起来还"活着"，但所有实时事件全部断流，你无法分辨"它没在动"还是"我网络断了"。

本插件在页面回前台时（并定期心跳）主动探测，确认网络与服务端都活着、而旧连接已死时，让服务端销毁现存连接、由控制器走既有重连逻辑——**全程不刷新页面**，草稿、滚动位置、输入状态完整保留，卡住的界面"自己活了"。

### 你看到什么

**会话标题左侧**常显一枚小圆点——颜色即状态，悬停展开文字：

| 圆点 | 含义 |
|---|---|
| 🟢 绿 | 连接正常 |
| ⚪ 灰 | 检查中 / 重连中 |
| 🔴 红（脉冲） | 离线 / 异常 / 正在恢复 |
| 🟢 绿（"已恢复 ✓"） | 重连完成，5 秒后回到常亮 |

**点击圆点 = 手动强制重连**——任何时候怀疑它卡了，点一下就有确定的结果。

## 安装

本地目录安装（[GitHub Release](https://github.com/enterhalf/dsh-web-network-optimizer/releases) 的 tgz 已含 `lib/`，解压即用；也可克隆仓库先 `npm run build && npm run build:client`）：

```bash
dsh plugin --profile web add /path/to/dsh-web-network-optimizer
```

卸载：

```bash
dsh plugin --profile web remove dsh-web-network-optimizer
```

卸载时路由包装完整还原、无残留；账本文件保留在 `~/.dsh/storages/dsh-web-network-optimizer/` 供回看。

缓存语义：资源 URL 带内容哈希 `rev=`——更新时内容变化 → 新 URL，旧缓存自然失效；卸载时孤儿缓存由浏览器自身配额回收，无需清理。

## 开发

```bash
npm run build          # 校验并产出 lib/index.js
npm run build:client   # 校验并产出 lib/client.js
```

## License

BSD-3-Clause
