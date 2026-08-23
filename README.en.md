# dsh-web-network-optimizer (Web Network Optimizer)

[中文](./README.md) | **English**

**dsh网页端网络优化：通过缓存与压缩技术降低传输，从而大幅提升网页加载速度；同时提供网络断连指示与自动断网重连功能。非常适合追求极致性能或网络不稳定用户使用。**

**Network optimization for the DSH web UI: reduces transfer size with caching and compression to greatly speed up page loading, plus a connection-drop indicator and automatic reconnection. Ideal for users pursuing peak performance or using unstable networks.**

1. **Connection Guard** — mobile carriers silently drop the network when the phone goes to the background, leaving the UI "permanently frozen": detected automatically, recovered within 1 second, with connection status shown as a small dot beside the conversation title (green = OK / gray = checking / red pulse = problem) and a manual forced reconnect on click;
2. **Response Compression** — every compressible response is served as brotli with gzip as fallback, identical behavior on local loopback and remote access;
3. **Browser Caching** — `/assets/*` and the favicon are content-hashed by filename (an update always yields a new URL), so they are served with `Cache-Control: immutable` and a second visit transfers almost nothing; plugin `client.js` (`rev=` URLs) keeps `no-cache` and the plugin adds an ETag — every load is a conditional revalidation: unchanged content gets a 304 (header bytes only), changed content is delivered fresh, near-zero traffic and always up to date;
4. **Per-Plugin Traffic Ledger** — the Settings → **Web Network Optimizer** panel shows, in real time, how much traffic each plugin uses per load and in total, how much compression saved, and cache-hit status;
5. **Cache Self-Check** — when you suspect the browser cache has not caught up with an update, the panel offers three one-click-copyable DevTools steps for clearing the browser cache manually.

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

Cache semantics: `/assets` and the favicon rely on content-hashed filenames — on update, changed content → new filename → new URL, so the old cache is naturally invalidated and `immutable` is safe; plugin `client.js` uses `no-cache + ETag` — every load revalidates conditionally (304 if unchanged, fresh content otherwise), which does not depend on URL changes and eliminates the "cache out of sync" blind spot (`immutable` means the browser never requests again, so no server-side technique can keep up with file changes — it is therefore reserved for filename-hashed resources only).

Cache self-check: extreme cases (a misbehaving browser cache, a rewriting proxy, etc.) can still leave stale content behind. Browsers expose no JavaScript API to clear the HTTP cache, so the panel's **Cache Self-Check** section lists three one-click-copyable DevTools steps (right-click the reload button → "Empty Cache and Hard Reload" / Network panel → "Disable cache" / Application panel → "Clear site data") — pick one and execute it manually once.

## Development

```bash
npm run build          # validate and produce lib/index.js
npm run build:client   # validate and produce lib/client.js
dsh plugin --profile web add /path/to/dsh-web-network-optimizer   # install from a local directory (development)
```

## License

MIT
