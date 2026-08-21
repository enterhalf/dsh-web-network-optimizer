/**
 * @dsh-external/dsh-web-optimizer — 浏览器端 bundle(单文件,经 __ModuleLoader__ 加载)。
 *
 * 设置页新增「Web 优化器」分节(settings.section):
 *   - 本次加载:基于 performance.getEntriesByType('resource'),按组件分组展示
 *     实际传输字节(transferSize)、解压后大小与缓存命中数;
 *   - 累计账本:GET /web-optimizer/ledger 拉取服务端分插件流量统计(请求数、
 *     线上流量、原始大小、压缩节省、占比),5 秒轮询;
 *   - 操作:刷新 / 重置账本(两步确认)。
 *
 * 样式全部使用 --dsw-* 主题变量,跟随全局亮/暗主题。
 */
window.__ModuleLoader__.load({
	id: '@dsh-external/dsh-web-optimizer',
	factory: (require) => {
		const module = { exports: {} }
		const exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const el = React.createElement

		// ── 常量 ──────────────────────────────────────────────────────────────

		const API_LEDGER = '/web-optimizer/ledger'
		const API_RESET = '/web-optimizer/reset'
		const POLL_MS = 5000

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
		].join('\n')

		let styleInjected = false
		function ensureStyle() {
			if (styleInjected) return
			styleInjected = true
			try {
				const tag = document.createElement('style')
				tag.id = 'dsh-web-optimizer-style'
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
			if (path === '/web-optimizer' || path.startsWith('/web-optimizer/')) return 'web-optimizer'
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

		// ── 入口 ──────────────────────────────────────────────────────────────

		const inject = ['slots']

		function apply(ctx) {
			const slots = ctx.get('slots')
			if (slots === undefined) return
			slots.inject('settings.section', () => {
				const dispose = slots.register({
					name: 'settings.section',
					id: 'web-optimizer',
					order: 40,
					label: 'Web 优化器',
					inject: () => ({}),
				}, WebOptimizerSection)
				return () => { dispose() }
			})
			return () => { /* 注册清理由 slots.inject 回调的 disposer 承担 */ }
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
