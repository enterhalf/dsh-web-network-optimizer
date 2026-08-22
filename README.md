# dsh-web-network-optimizer（Web 网络优化器）

**中文** | [English](./README.en.md)

**dsh网页端网络优化：通过缓存与压缩技术降低传输，从而大幅提升网页加载速度；同时提供网络断连指示与自动断网重连功能。非常适合追求极致性能或网络不稳定用户使用。**

**Network optimization for the DSH web UI: reduces transfer size with caching and compression to greatly speed up page loading, plus a connection-drop indicator and automatic reconnection. Ideal for users pursuing peak performance or using unstable networks.**

1. **连接守护**——手机切后台后运营商静默断网导致"界面永久卡死"：自动检测、1 秒内自动恢复，连接状态以会话标题左侧的小圆点常显（绿=正常 / 灰=检查中 / 红脉冲=异常），点圆点可手动强制重连；
2. **响应压缩**——所有可压缩响应下发 brotli、gzip 兜底，本地回环与远程访问行为一致；
3. **浏览器缓存**——内容哈希资源（`rev=` URL、`/assets/*`、favicon）下发 `Cache-Control: immutable`，二次访问近乎零传输；
4. **分插件流量账本**——设置 → **Web 网络优化器** 面板，实时看到每个插件本次加载与累计占用多少流量、压缩省了多少、缓存命中情况。

## 实测效果

完整加载 GUI（87 个静态请求）：首屏静态流量 8.1 MB → **1.54 MB（−81%）**，缓存命中后二次访问静态零传输；最大 API `/api/session.list` 2.18 MB → **144 KB（−93%）**。

## 连接守护

手机切到后台后，运营商往往**静默切断 TCP 连接**。浏览器被冻结、感知不到断开，WebSocket 状态停在 `OPEN`，连接控制器认为连接健康。回到前台：界面看起来还"活着"，但实时数据全部断流——分不清"它没在动"还是"我网络断了"。

本插件在页面回前台时（以及每 30 秒心跳）主动探测连接的真实状态；发现旧连接已死、而网络与服务端都活着时，由服务端销毁旧连接、控制器走既有重连逻辑。恢复过程完整保留页面内存状态——草稿、滚动位置、输入内容原样保留，卡住的界面"自己活了"。

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

卸载时路由包装完整还原；账本文件保留在 `~/.dsh/storages/dsh-web-network-optimizer/` 供回看，孤儿缓存由浏览器配额自动回收。

缓存语义：资源 URL 带内容哈希 `rev=`——更新时内容变化 → 新 URL，旧缓存自然失效。

## 开发

```bash
npm run build          # 校验并产出 lib/index.js
npm run build:client   # 校验并产出 lib/client.js
```

## License

MIT
