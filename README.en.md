# dsh-web-network-optimizer (Web Network Optimizer)

[中文](./README.md) | **English**

**dsh网页端网络优化：通过缓存与压缩技术降低传输，从而大幅提升网页加载速度；同时提供网络断连指示与自动断网重连功能。非常适合追求极致性能或网络不稳定用户使用。**

**Network optimization for the DSH web UI: reduces transfer size with caching and compression to greatly speed up page loading, plus a connection-drop indicator and automatic reconnection. Ideal for users pursuing peak performance or using unstable networks.**

1. **Connection Guard** — mobile carriers silently drop the network when the phone goes to the background, leaving the UI "permanently frozen": detected automatically, recovered within 1 second, with connection status shown as a small dot beside the conversation title (green = OK / gray = checking / red pulse = problem) and a manual forced reconnect on click;
2. **Response Compression** — every compressible response is served as brotli with gzip as fallback, identical behavior on local loopback and remote access;
3. **Browser Caching** — content-hashed resources (`rev=` URLs, `/assets/*`, favicon) are served with `Cache-Control: immutable`, so a second visit transfers almost nothing;
4. **Per-Plugin Traffic Ledger** — the Settings → **Web Network Optimizer** panel shows, in real time, how much traffic each plugin uses per load and in total, how much compression saved, and cache-hit status.

## Measured Results

Full GUI load (87 static requests): first-load static traffic 8.1 MB → **1.54 MB (−81%)**, zero static transfer on a cache-hit second visit; largest API `/api/session.list` 2.18 MB → **144 KB (−93%)**.

## Connection Guard

After the phone goes to the background, carriers often **silently cut the TCP connection**. The browser is frozen and never notices the drop: the WebSocket state stays `OPEN`, and the connection controller believes the connection is healthy. Back in the foreground: the UI still looks "alive", but all real-time data is dead — you cannot tell "it is not moving" from "my network dropped".

This plugin actively probes the real connection state when the page returns to the foreground (and on a 30-second heartbeat); when it finds the old connection is dead while the network and the server are both alive, the server destroys the old connection and the controller follows its existing reconnect logic. Recovery keeps the page's in-memory state intact — drafts, scroll position, and in-progress input all survive, and the frozen UI "comes back to life" on its own.

### What you see

A small dot is always shown to the **left of the conversation title** — color is the status, hover expands the text:

| Dot | Meaning |
|---|---|
| 🟢 Green | Connection healthy |
| ⚪ Gray | Checking / reconnecting |
| 🔴 Red (pulsing) | Offline / problem / recovering |
| 🟢 Green ("recovered ✓") | Reconnect complete, returns to solid green after 5 seconds |

**Clicking the dot = manual forced reconnect** — whenever you suspect it is stuck, one click gives a definite result.

## Installation

```bash
dsh plugin --profile web add dsh-web-network-optimizer@latest
```

Uninstall:

```bash
dsh plugin --profile web remove dsh-web-network-optimizer
```

Uninstalling restores the route wrapping completely; the ledger file is kept in `~/.dsh/storages/dsh-web-network-optimizer/` for review, and orphaned cache is reclaimed by the browser's own quota.

Cache semantics: resource URLs carry a content hash `rev=` — on update, changed content → new URL, old cache is naturally invalidated.

## Development

```bash
npm run build          # validate and produce lib/index.js
npm run build:client   # validate and produce lib/client.js
dsh plugin --profile web add /path/to/dsh-web-network-optimizer   # install from a local directory (development)
```

## License

MIT
