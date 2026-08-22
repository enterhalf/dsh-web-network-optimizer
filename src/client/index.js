/**
 * dsh-web-network-optimizer — 浏览器端 bundle(单文件,经 __ModuleLoader__ 加载)。
 *
 * 设置页新增「Web 网络优化器」分节(settings.section):
 *   - 本次加载:基于 performance.getEntriesByType('resource'),按组件分组展示
 *     实际传输字节(transferSize)、解压后大小与缓存命中数;
 *   - 累计账本:GET /web-network-optimizer/ledger 拉取服务端分插件流量统计(请求数、
 *     线上流量、原始大小、压缩节省、占比),5 秒轮询;
 *   - 操作:刷新 / 重置账本(两步确认)。
 *
 * 连接守护(会话标题左侧圆点):移动端切后台 TCP 被运营商静默切断时,
 * WebSocket 永远 OPEN、连接控制器永不重连 → 界面永久卡死。三层主动探针
 * (navigator.onLine / host.describe / WS 握手)判定僵尸连接后,调
 * POST /web-network-optimizer/kick 让服务端销毁全部 upgrade socket,
 * 控制器走既有重连 + 运行时自动重同步,页面不刷新、内存状态全保留。
 * 圆点常显于会话标题左侧(conversation.session.header.actions 槽位内,
 * CSS 绝对定位):颜色即状态(绿=正常/灰=过渡/红=异常,红点脉冲),
 * 悬停展开文字,点击 = 手动强制重连。
 *
 * 样式全部使用 --dsw-* 主题变量,跟随全局亮/暗主题。
 */
window.__ModuleLoader__.load({
	id: 'dsh-web-network-optimizer',
	factory: (require) => {
		const module = { exports: {} }
		const exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const el = React.createElement

		// ── 常量 ──────────────────────────────────────────────────────────────

		const API_LEDGER = '/web-network-optimizer/ledger'
		const API_RESET = '/web-network-optimizer/reset'
		const API_KICK = '/web-network-optimizer/kick'
		const POLL_MS = 5000

		// 连接守护计时参数
		const PROBE_TIMEOUT_MS = 4500 // 单层探针超时(描述 RPC / WS 握手)
		const HEARTBEAT_MS = 30000 // 可见时每 30s 主动心跳探针
		const REPROBE_MS = 5000 // 不健康时的自愈重试间隔
		const KICK_COOLDOWN_MS = 4000 // 自动 kick 冷却
		const HIDDEN_GATE_MS = 8000 // 页面后台 ≥8s 才允许自动 kick(僵尸判定门)
		const RECOVERED_HIDE_MS = 5000 // "已恢复" 提示停留时长
		const STARTUP_PROBE_MS = 1500 // 加载后的首次探针

		const CSS = [
			'.wo-root{display:flex;flex-direction:column;gap:18px;padding:4px 2px 24px;font-size:13px;color:var(--dsw-alias-label-primary)}',
			'.wo-note{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:19px;margin:0}',
			'.wo-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
			'.wo-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);min-width:0}',
			'.wo-card-title{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.wo-card-value{font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.wo-card-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.wo-h{font-size:13px;font-weight:600;margin:0 0 8px}',
			'.wo-scroll{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:auto;max-height:340px}',
			'.wo-table{width:100%;border-collapse:collapse;font-size:12px}',
			'.wo-table th,.wo-table td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}',
			'.wo-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;position:sticky;top:0;background:var(--dsw-alias-bg-layer-1)}',
			'.wo-table tr:last-child td{border-bottom:none}',
			'.wo-table .num{text-align:right;font-variant-numeric:tabular-nums}',
			'.wo-key{max-width:340px;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
			'.wo-key.dim{color:var(--dsw-alias-label-secondary)}',
			'.wo-bar{display:inline-block;width:90px;height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;vertical-align:middle;margin-right:8px}',
			'.wo-bar-fill{height:100%;border-radius:3px;background:var(--dsw-alias-state-business-primary)}',
			'.wo-badge{display:inline-block;font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 8px;margin-left:6px}',
			'.wo-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
			'.wo-btn{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;cursor:pointer}',
			'.wo-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.wo-btn.danger{color:var(--dsw-alias-state-error-primary)}',
			'.wo-btn:disabled{opacity:.55;cursor:default}',
			'.wo-msg{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
			'.wo-msg.err{color:var(--dsw-alias-state-error-primary)}',
			'.wo-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:14px 10px}',
			// 圆点定位在会话标题左侧:挂在 conversation.session.header.actions 槽位内,
			// 用绝对定位脱离 flex 流。横向参照 = 标题簇左缘(标题实际起始的车道):运行时实测
			// 标题簇左缘在含块内的偏移并写入 --wog-title-x(见 GuardBadge 内的 effect)。
			// 不写死头部坐标(窄屏标题行有让位抽屉开关的额外缩进),也不给共享的
			// titleCluster 加定位上下文(会连带改变同槽位内其他绝对定位元素的参照系);
			// 标题簇让位 8px。属性包含选择器[class*=...]对 CSS-module 哈希前缀免疫。
			'.wog-chip{position:absolute;left:var(--wog-title-x,20px);top:22px;z-index:1;display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:12px;line-height:18px;width:auto;max-width:12px;height:12px;padding:0;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;transition:max-width .18s ease,height .18s ease,top .18s ease,padding .18s ease,border-color .18s ease,background-color .18s ease}',
			'.wog-chip:hover{max-width:320px;height:22px;top:18px;padding:0 12px 0 0;border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-button-floating-fill);box-shadow:0 1px 6px rgba(0,0,0,.12)}',
			'.wog-dot{width:10px;height:10px;border-radius:50%;flex:none}',
			'.wog-text{display:none}',
			'.wog-chip:hover .wog-text{display:inline;margin-left:8px}',
			'.wog-chip.wog-ok .wog-dot{background:var(--dsw-alias-state-success-primary)}',
			'.wog-chip.wog-neutral .wog-dot{background:var(--dsw-alias-label-tertiary)}',
			'.wog-chip.wog-err{color:var(--dsw-alias-state-error-primary)}',
			'.wog-chip.wog-err .wog-dot{background:var(--dsw-alias-state-error-primary);animation:wog-pulse 1.2s ease-in-out infinite}',
			'[class*="titleCluster"]{padding-left:8px}',
			'@keyframes wog-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
		].join('\n')

		let styleInjected = false
		function ensureStyle() {
			if (styleInjected) return
			styleInjected = true
			try {
				const tag = document.createElement('style')
				tag.id = 'dsh-web-network-optimizer-style'
				tag.textContent = CSS
				document.head.appendChild(tag)
			} catch { /* 样式失败不影响功能 */ }
		}

		// ── 展示助手 ──────────────────────────────────────────────────────────

		function fmtBytes(n) {
			if (!Number.isFinite(n) || n <= 0) return '0 B'
			if (n < 1024) return Math.round(n) + ' B'
			if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
			if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
			return (n / 1073741824).toFixed(2) + ' GB'
		}

		function fmtShare(x) {
			if (!Number.isFinite(x) || x <= 0) return '—'
			if (x < 0.001) return '<0.1%'
			if (x < 0.1) return (x * 100).toFixed(1) + '%'
			return (x * 100).toFixed(0) + '%'
		}

		function fmtTime(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return '—'
			const d = new Date(ms)
			const p = (v) => String(v).padStart(2, '0')
			return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
		}

		/** 资源 URL → 统计 key(与服务端 keyFor 对齐)。 */
		function groupResource(entryName) {
			let path = String(entryName || '')
			try { path = new URL(path, location.origin).pathname } catch { /* 保留原样 */ }
			if (path === '/plugins' || path.startsWith('/plugins/')) {
				const parts = path.split('/').filter(Boolean)
				const id = parts[1] && parts[1].startsWith('@') ? (parts[1] + '/' + (parts[2] || '')) : (parts[1] || 'unknown')
				return 'plugin:' + id
			}
			if (path.startsWith('/assets/')) return 'frontend-core'
			if (path === '/api' || path.startsWith('/api/')) {
				return 'api:' + (path.slice(5).split('/')[0] || 'api')
			}
			if (path === '/auth' || path.startsWith('/auth/')) return 'auth'
			if (path === '/web-network-optimizer' || path.startsWith('/web-network-optimizer/')) return 'web-optimizer'
			if (path === '/') return 'shell'
			if (path === '/favicon.svg' || path === '/manifest.webmanifest') return 'misc'
			return 'other'
		}

		const FALLBACK_LABELS = {
			'frontend-core': '核心前端',
			'auth': '登录认证',
			'web-optimizer': '优化器 API',
			'shell': '页面外壳',
			'misc': 'favicon/manifest',
			'other': '其他',
			'other:long-tail': '长尾折叠',
		}

		function labelOf(key, ledgerLabels) {
			if (ledgerLabels && typeof ledgerLabels[key] === 'string' && ledgerLabels[key] !== '') return ledgerLabels[key]
			if (FALLBACK_LABELS[key] !== undefined) return FALLBACK_LABELS[key]
			if (key.startsWith('plugin:')) return key.slice('plugin:'.length)
			if (key.startsWith('api:')) return 'API · ' + key.slice('api:'.length)
			return key
		}

		/** 本次页面加载的 Resource Timing 统计。 */
		function pageLoadStats() {
			let entries = []
			try { entries = performance.getEntriesByType('resource') || [] } catch { return null }
			const groups = Object.create(null)
			let totalTransfer = 0
			let totalDecoded = 0
			let cached = 0
			for (const e of entries) {
				const key = groupResource(e.name)
				const g = groups[key] || (groups[key] = { key, requests: 0, transfer: 0, decoded: 0, cached: 0 })
				g.requests += 1
				const t = Number(e.transferSize) || 0
				const d = Number(e.decodedBodySize) || 0
				g.transfer += t
				g.decoded += d
				totalTransfer += t
				totalDecoded += d
				if (t === 0) { g.cached += 1; cached += 1 }
			}
			const rows = Object.values(groups).sort((a, b) => b.transfer - a.transfer)
			return { rows, totalTransfer, totalDecoded, cached, total: entries.length, at: Date.now() }
		}

		// ── 数据通道 ──────────────────────────────────────────────────────────

		async function fetchLedger() {
			const res = await fetch(API_LEDGER, { credentials: 'same-origin' })
			if (!res.ok) throw new Error('HTTP ' + res.status)
			const data = await res.json()
			if (!data || data.ok !== true) throw new Error('无效账本响应')
			return data
		}

		async function resetLedger() {
			const res = await fetch(API_RESET, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			})
			if (!res.ok) throw new Error('HTTP ' + res.status)
		}

		// ── 组件 ──────────────────────────────────────────────────────────────

		function WebOptimizerSection() {
			ensureStyle()
			const [ledger, setLedger] = React.useState(null)
			const [error, setError] = React.useState('')
			const [load, setLoad] = React.useState(() => pageLoadStats())
			const [busy, setBusy] = React.useState(false)
			const [confirmReset, setConfirmReset] = React.useState(false)
			const [resetMsg, setResetMsg] = React.useState('')

			const refresh = React.useCallback(async () => {
				try {
					const data = await fetchLedger()
					setLedger(data)
					setLoad(pageLoadStats())
					setError('')
				} catch (e) {
					setError(String((e && e.message) || e))
				}
			}, [])

			React.useEffect(() => {
				refresh()
				const timer = setInterval(() => { refresh() }, POLL_MS)
				return () => clearInterval(timer)
			}, [refresh])

			const onManualRefresh = () => {
				setBusy(true)
				refresh().finally(() => setBusy(false))
			}

			const onReset = () => {
				if (!confirmReset) {
					setConfirmReset(true)
					setResetMsg('')
					return
				}
				setConfirmReset(false)
				setBusy(true)
				resetLedger()
					.then(() => { setResetMsg('账本已重置。'); return refresh() })
					.catch((e) => setResetMsg('重置失败:' + String((e && e.message) || e)))
					.finally(() => setBusy(false))
			}

			const totals = ledger?.totals ?? { requests: 0, raw: 0, wire: 0, saved: 0 }
			const keys = ledger?.keys ?? []
			const today = ledger?.days?.[0] ?? null
			const ledgerLabels = Object.create(null)
			for (const k of keys) if (k && k.key && k.label) ledgerLabels[k.key] = k.label

			const zeroTraffic = load !== null && load.totalTransfer === 0

			return el('div', { className: 'wo-root' },
				el('p', { className: 'wo-note' },
					'本插件对所有响应做 brotli/gzip 压缩(本地与远程一致),并给内容哈希资源(/assets、/plugins、rev= URL)下发 ',
					el('code', null, 'Cache-Control: immutable'),
					':浏览器首次下载后长期复用,再次进入页面几乎零流量。插件更新 → 内容变化 → 新 rev → 自动重新下载;插件卸载 → 旧缓存失去引用,由浏览器自行回收。'),
				el('div', { className: 'wo-cards' },
					el('div', { className: 'wo-card' },
						el('p', { className: 'wo-card-title' }, '本次加载流量'),
						el('p', { className: 'wo-card-value' }, load ? fmtBytes(load.totalTransfer) : '…'),
						el('p', { className: 'wo-card-sub' },
							load
								? (zeroTraffic
									? '全部来自缓存 — 这正是目标'
									: `解压后 ${fmtBytes(load.totalDecoded)}`)
								: ''),
					),
					el('div', { className: 'wo-card' },
						el('p', { className: 'wo-card-title' }, '本次请求'),
						el('p', { className: 'wo-card-value' }, load ? String(load.total) : '…'),
						el('p', { className: 'wo-card-sub' }, load ? `其中 ${load.cached} 个缓存命中` : ''),
					),
					el('div', { className: 'wo-card' },
						el('p', { className: 'wo-card-title' }, '累计线上流量'),
						el('p', { className: 'wo-card-value' }, fmtBytes(totals.wire)),
						el('p', { className: 'wo-card-sub' }, today ? `今日 ${fmtBytes(today.wire)}` : '今日暂无记录'),
					),
					el('div', { className: 'wo-card' },
						el('p', { className: 'wo-card-title' }, '累计请求'),
						el('p', { className: 'wo-card-value' }, String(totals.requests)),
						el('p', { className: 'wo-card-sub' }, '自账本建立(或重置)起'),
					),
					el('div', { className: 'wo-card' },
						el('p', { className: 'wo-card-title' }, '压缩节省'),
						el('p', { className: 'wo-card-value' }, fmtBytes(totals.saved)),
						el('p', { className: 'wo-card-sub' }, totals.raw > 0 ? `原始 ${fmtBytes(totals.raw)}` : ''),
					),
				),
				el('section', null,
					el('h3', { className: 'wo-h' }, '本次页面加载',
						el('span', { className: 'wo-badge' }, 'performance API,实时')),
					load && load.rows.length === 0
						? el('div', { className: 'wo-empty' }, '尚未产生资源请求。')
						: el('div', { className: 'wo-scroll' },
							el('table', { className: 'wo-table' },
								el('thead', null, el('tr', null,
									el('th', null, '组件'),
									el('th', { className: 'num' }, '请求'),
									el('th', { className: 'num' }, '实际传输'),
									el('th', { className: 'num' }, '解压后'),
									el('th', { className: 'num' }, '缓存命中'),
								)),
								el('tbody', null,
									load.rows.map((g) => el('tr', { key: g.key },
										el('td', { className: 'wo-key' }, labelOf(g.key, ledgerLabels)),
										el('td', { className: 'num' }, String(g.requests)),
										el('td', { className: 'num' }, g.transfer === 0 ? el('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, '0(缓存)') : fmtBytes(g.transfer)),
										el('td', { className: 'num' }, fmtBytes(g.decoded)),
										el('td', { className: 'num' }, String(g.cached)),
									)),
									el('tr', null,
										el('td', { style: { fontWeight: 600 } }, '合计'),
										el('td', { className: 'num' }, String(load.total)),
										el('td', { className: 'num', style: { fontWeight: 600 } }, fmtBytes(load.totalTransfer)),
										el('td', { className: 'num', style: { fontWeight: 600 } }, fmtBytes(load.totalDecoded)),
										el('td', { className: 'num' }, String(load.cached)),
									),
								),
							),
						),
				),
				el('section', null,
					el('h3', { className: 'wo-h' }, '累计账本(按组件)',
						el('span', { className: 'wo-badge' }, `${POLL_MS / 1000}s 轮询`)),
					error
						? el('p', { className: 'wo-msg err' }, '账本读取失败:' + error)
						: keys.length === 0
							? el('div', { className: 'wo-empty' }, '账本为空——刷新一下页面,流量就会开始记账。')
							: el('div', { className: 'wo-scroll' },
								el('table', { className: 'wo-table' },
									el('thead', null, el('tr', null,
										el('th', null, '组件'),
										el('th', { className: 'num' }, '请求数'),
										el('th', { className: 'num' }, '线上流量'),
										el('th', { className: 'num' }, '原始大小'),
										el('th', { className: 'num' }, '节省'),
										el('th', { className: 'num' }, '占比'),
										el('th', null, '最近'),
									)),
									el('tbody', null,
										keys.slice(0, 200).map((k) => el('tr', { key: k.key },
											el('td', { className: 'wo-key', title: k.key }, labelOf(k.key, ledgerLabels)),
											el('td', { className: 'num' }, String(k.requests)),
											el('td', { className: 'num', style: { fontWeight: 600 } }, fmtBytes(k.wire)),
											el('td', { className: 'num', style: { color: 'var(--dsw-alias-label-secondary)' } }, fmtBytes(k.raw)),
											el('td', { className: 'num', style: { color: k.saved > 0 ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' } }, k.saved > 0 ? '−' + fmtBytes(k.saved) : '—'),
											el('td', { className: 'num' },
												el('span', { className: 'wo-bar' },
													el('span', { className: 'wo-bar-fill', style: { width: Math.max(2, Math.min(100, k.share * 100)) + '%' } })),
												fmtShare(k.share)),
											el('td', { className: 'wo-key dim' }, fmtTime(k.lastAt)),
										)),
										el('tr', null,
											el('td', { style: { fontWeight: 600 } }, '合计'),
											el('td', { className: 'num' }, String(totals.requests)),
											el('td', { className: 'num', style: { fontWeight: 600 } }, fmtBytes(totals.wire)),
											el('td', { className: 'num' }, fmtBytes(totals.raw)),
											el('td', { className: 'num' }, totals.saved > 0 ? '−' + fmtBytes(totals.saved) : '—'),
											el('td', { className: 'num' }, '100%'),
											el('td', null, ''),
										),
									),
								),
							),
				),
				el('div', { className: 'wo-actions' },
					el('button', { className: 'wo-btn', disabled: busy, onClick: onManualRefresh }, '刷新'),
					el('button', {
						className: 'wo-btn' + (confirmReset ? ' danger' : ''),
						disabled: busy || !ledger,
						onClick: onReset,
						onMouseLeave: () => setConfirmReset(false),
					}, confirmReset ? '再点一次确认重置' : '重置账本'),
					resetMsg ? el('span', { className: 'wo-msg' + (resetMsg.indexOf('失败') === 0 ? ' err' : '') }, resetMsg) : null,
					ledger?.meta?.now ? el('span', { className: 'wo-msg' }, '更新于 ' + fmtTime(ledger.meta.now)) : null,
				),
			)
		}

		// ── 连接守护 ──────────────────────────────────────────────────────────
		//
		// 问题:移动端切后台后运营商悄悄切断 TCP,浏览器冻结收不到 close 事件,
		// WebSocket 永远停留在 OPEN,连接控制器不会重连 → 界面永久卡死,
		// 用户分不清"没动"还是"网络断了"。
		//
		// 方案:三层主动探针 + 外科手术式 kick。
		//   1) navigator.onLine 为 false → 离线(只信 false);
		//   2) host.describe unary(fetch,4.5s 超时)→ 通网与否;
		//   3) 自建 /api/events.mux WebSocket 握手(4.5s)→ 长连接通道可用性。
		// 2+3 都通、而控制器自认已连接、且页面曾在后台 ≥8s(或 online 事件)
		// → 判定旧连接是僵尸 → kick 端点销毁服务端全部 upgrade socket,
		// 控制器的 for-await 收到 1006 后走既有重连 + 运行时自动重同步,
		// 页面不刷新,草稿/滚动等内存状态全保留。
		// 状态:ok(绿点) / probing / reconnecting / offline / neterr /
		//       streamerr / zombie(恢复中) / recovered(5s 后回 ok)。
		// 圆点常显于会话标题左侧,悬停展开文字,点击 = 手动强制重连(绕过冷却)。

		const GUARD_LABELS = {
			ok: { text: '连接正常', tone: 'ok' },
			probing: { text: '检查中…', tone: 'neutral' },
			reconnecting: { text: '重连中…', tone: 'neutral' },
			offline: { text: '离线 · 等待网络', tone: 'err' },
			neterr: { text: '网络异常 · 自动检测中', tone: 'err' },
			streamerr: { text: '连接通道异常 · 检测中', tone: 'err' },
			zombie: { text: '僵尸连接 · 正在恢复…', tone: 'err' },
			recovered: { text: '已恢复 ✓', tone: 'ok' },
		}

		const guard = {
			state: 'ok',
			handle: null,
			attached: false,
			probing: false,
			probeToken: 0,
			hasEverConnected: false,
			hiddenSince: null,
			lastKickAt: 0,
			kickInFlight: false,
			reprobeTimer: 0,
			recoveredTimer: 0,
			heartbeatTimer: 0,
			startupTimer: 0,
			listeners: new Set(),
			cleanup: [],
		}

		function gNotify() {
			for (const fn of [...guard.listeners]) { try { fn(guard.state) } catch { /* 忽略订阅者异常 */ } }
		}

		function gSetState(next) {
			if (guard.state === next) return
			guard.state = next
			gNotify()
		}

		function gUnhealthy() {
			return guard.state === 'offline' || guard.state === 'neterr' ||
				guard.state === 'streamerr' || guard.state === 'reconnecting'
		}

		function gClearReprobe() {
			if (guard.reprobeTimer) { clearTimeout(guard.reprobeTimer); guard.reprobeTimer = 0 }
		}

		function gScheduleReprobe() {
			if (guard.reprobeTimer) return
			if (!gUnhealthy()) return
			guard.reprobeTimer = setTimeout(() => { guard.reprobeTimer = 0; gProbe('reprobe', { canKick: false }) }, REPROBE_MS)
		}

		function gMarkRecovered() {
			gClearReprobe()
			gSetState('recovered')
			if (guard.recoveredTimer) clearTimeout(guard.recoveredTimer)
			guard.recoveredTimer = setTimeout(() => {
				guard.recoveredTimer = 0
				if (guard.state === 'recovered') gSetState('ok')
			}, RECOVERED_HIDE_MS)
		}

		/** 探针层 2:unary host.describe(带超时与中止)。 */
		async function gDescribeProbe(api, timeoutMs) {
			const ac = new AbortController()
			const t = setTimeout(() => ac.abort(), timeoutMs)
			try {
				const res = await api.host.describe({}, ac.signal)
				return !!(res && res.result && res.result.ok === true)
			} catch { return false }
			finally { clearTimeout(t) }
		}

		/** 探针层 3:自建 WebSocket 握手(成功即立即关闭)。 */
		function gWsHandshakeProbe(timeoutMs) {
			return new Promise((resolve) => {
				let ws
				let settled = false
				const finish = (ok) => {
					if (settled) return
					settled = true
					clearTimeout(t)
					try { if (ws) ws.close() } catch { /* 已关闭 */ }
					resolve(ok)
				}
				try {
					const url = new URL('/api/events.mux', location.origin)
					url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
					ws = new WebSocket(url.toString())
				} catch { return resolve(false) }
				const t = setTimeout(() => finish(false), timeoutMs)
				ws.addEventListener('open', () => finish(true), { once: true })
				ws.addEventListener('error', () => finish(false), { once: true })
				ws.addEventListener('close', () => finish(false), { once: true })
			})
		}

		/** 外科手术式 kick:让服务端销毁全部 upgrade socket。 */
		async function gKick(manual) {
			if (guard.kickInFlight) return
			const now = Date.now()
			if (!manual && now - guard.lastKickAt < KICK_COOLDOWN_MS) return
			guard.lastKickAt = now
			guard.kickInFlight = true
			gSetState('zombie')
			try {
				const res = await fetch(API_KICK, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json' },
					body: '{}',
				})
				if (!res.ok) throw new Error('HTTP ' + res.status)
			} catch {
				/* kick 通道本身不可用 → 下面按网络问题继续检测 */
			} finally {
				guard.kickInFlight = false
			}
			// kick 后控制器的旧流将收到 1006 并走既有重连;此处先显示"重连中",
			// 由探针链与 hostDescription 订阅跟踪到恢复
			gClearReprobe()
			gSetState('reconnecting')
			gScheduleReprobe()
		}

		/** 三层探针主流程。opts.canKick:本次探针是否允许判定僵尸并 kick。 */
		async function gProbe(reason, opts) {
			if (!guard.handle || guard.probing) return
			const canKick = !!(opts && opts.canKick)
			guard.probing = true
			const token = ++guard.probeToken
			// 健康状态下静默探针,徽章保持"连接正常"不闪烁
			if (guard.state !== 'ok' && guard.state !== 'recovered') gSetState('probing')
			try {
				// 层 1:只信 navigator.onLine === false
				if (typeof navigator !== 'undefined' && navigator.onLine === false) {
					gSetState('offline')
					gScheduleReprobe()
					return
				}
				// 层 2:unary 通网
				const descOk = await gDescribeProbe(guard.handle.api, PROBE_TIMEOUT_MS)
				if (token !== guard.probeToken) return
				if (!descOk) { gSetState('neterr'); gScheduleReprobe(); return }
				// 层 3:长连接通道
				const wsOk = await gWsHandshakeProbe(PROBE_TIMEOUT_MS)
				if (token !== guard.probeToken) return
				if (!wsOk) { gSetState('streamerr'); gScheduleReprobe(); return }
				// 网络全通:看控制器的自我认知
				const snap = guard.handle.hostDescription.getSnapshot()
				if (snap === undefined) {
					if (guard.hasEverConnected) { gSetState('reconnecting'); gScheduleReprobe() }
					else { gSetState('ok'); gScheduleReprobe() } // 启动期首次连接尚未落地
					return
				}
				// 探针全通 + 控制器自认已连接 + 有僵尸嫌疑 → kick
				if (canKick) { gKick(false); return }
				gClearReprobe()
				if (guard.state === 'recovered') return // 保留"已恢复"提示,5s 后自动回 ok
				gSetState('ok')
			} finally {
				guard.probing = false
			}
		}

		function gOnDescChange() {
			const snap = guard.handle.hostDescription.getSnapshot()
			if (snap !== undefined) {
				guard.hasEverConnected = true
				if (gUnhealthy() || guard.state === 'zombie') gMarkRecovered()
			} else if (guard.hasEverConnected && (guard.state === 'ok' || guard.state === 'recovered' || guard.state === 'zombie')) {
				gSetState('reconnecting')
				gScheduleReprobe()
			}
		}

		function gAttach(connection) {
			if (guard.attached) return
			guard.attached = true
			guard.handle = connection
			guard.cleanup.push(connection.hostDescription.subscribe(gOnDescChange))

			const onVis = () => {
				if (document.visibilityState === 'hidden') {
					if (guard.hiddenSince === null) guard.hiddenSince = Date.now()
				} else if (guard.hiddenSince !== null) {
					const dur = Date.now() - guard.hiddenSince
					guard.hiddenSince = null
					if (dur >= HIDDEN_GATE_MS) gProbe('visibility', { canKick: true })
				}
			}
			const onOnline = () => gProbe('online', { canKick: true })
			const onOffline = () => { gSetState('offline'); gScheduleReprobe() }

			document.addEventListener('visibilitychange', onVis)
			window.addEventListener('online', onOnline)
			window.addEventListener('offline', onOffline)
			guard.cleanup.push(() => {
				document.removeEventListener('visibilitychange', onVis)
				window.removeEventListener('online', onOnline)
				window.removeEventListener('offline', onOffline)
			})

			guard.heartbeatTimer = setInterval(() => {
				if (document.visibilityState === 'visible') gProbe('heartbeat', { canKick: false })
			}, HEARTBEAT_MS)
			guard.cleanup.push(() => clearInterval(guard.heartbeatTimer))

			guard.startupTimer = setTimeout(() => gProbe('startup', { canKick: false }), STARTUP_PROBE_MS)
			guard.cleanup.push(() => clearTimeout(guard.startupTimer))
		}

		function gDetach() {
			if (!guard.attached) return
			guard.attached = false
			for (const fn of guard.cleanup.splice(0)) { try { fn() } catch { /* 忽略 */ } }
			gClearReprobe()
			if (guard.recoveredTimer) { clearTimeout(guard.recoveredTimer); guard.recoveredTimer = 0 }
			if (guard.heartbeatTimer) { clearInterval(guard.heartbeatTimer); guard.heartbeatTimer = 0 }
			if (guard.startupTimer) { clearTimeout(guard.startupTimer); guard.startupTimer = 0 }
			guard.handle = null
			guard.hiddenSince = null
			guard.listeners.clear()
			guard.state = 'ok'
		}

		function GuardBadge() {
			ensureStyle()
			const [state, setState] = React.useState(guard.state)
			const chipRef = React.useRef(null)
			React.useEffect(() => {
				const fn = (s) => setState(s)
				guard.listeners.add(fn)
				return () => { guard.listeners.delete(fn) }
			}, [])
			// 圆点贴标题左缘:实测标题簇左缘在圆点含块(offsetParent)内的偏移,
			// 写入 --wog-title-x。useLayoutEffect 在首帧绘制前完成,无闪烁;
			// 头部几何变化(窗口/断点/侧边栏/空白会话显隐)时 ResizeObserver 重测。
			// 测量而非写死或给共享元素加定位上下文:标题在哪,点就跟到哪。
			React.useLayoutEffect(() => {
				const chip = chipRef.current
				if (!chip) return
				const sync = () => {
					const cluster = chip.closest('[class*="titleCluster"]')
					if (!cluster) return
					const r = cluster.getBoundingClientRect()
					if (r.width === 0) return // 头部隐藏(空白会话),保留上次值
					const ref = chip.offsetParent || document.documentElement
					chip.style.setProperty('--wog-title-x', (r.left - ref.getBoundingClientRect().left) + 'px')
				}
				sync()
				let ro = null
				const header = chip.closest('header')
				if (header && typeof ResizeObserver !== 'undefined') {
					ro = new ResizeObserver(sync)
					ro.observe(header)
				}
				return () => { if (ro) ro.disconnect() }
			}, [])
			const info = GUARD_LABELS[state] || GUARD_LABELS.ok
			return el('button', {
				ref: chipRef,
				className: 'wog-chip wog-' + info.tone,
				title: '连接守护:' + info.text + ' — 点击 = 强制重连',
				onClick: () => { if (guard.handle) gKick(true) },
			},
				el('span', { className: 'wog-dot' }),
				el('span', { className: 'wog-text' }, info.text),
			)
		}

		// ── 入口 ──────────────────────────────────────────────────────────────

		const inject = ['slots']

		function apply(ctx) {
			const slots = ctx.get('slots')
			const connection = ctx.get('connection')
			if (slots !== undefined) {
				slots.inject('settings.section', () => {
					const dispose = slots.register({
						name: 'settings.section',
						id: 'web-optimizer',
						order: 40,
						label: 'Web 网络优化器',
						inject: () => ({}),
					}, WebOptimizerSection)
					return () => { dispose() }
				})
				if (connection !== undefined) {
					gAttach(connection)
					// 圆点挂在会话头部 actions 槽位内,由 CSS 绝对定位到会话标题左侧
					slots.inject('conversation.session.header.actions', () => {
						const dispose = slots.register({
							name: 'conversation.session.header.actions',
							id: 'web-optimizer-guard',
							order: -10,
							label: '连接守护',
							inject: () => ({}),
						}, GuardBadge)
						return () => { dispose() }
					})
				}
			}
			return () => {
				// 注册清理由 slots.inject 回调的 disposer 承担;守护资源在这里释放
				gDetach()
			}
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
