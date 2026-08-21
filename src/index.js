/**
 * @dsh-external/dsh-web-optimizer — Web 优化器(host half).
 *
 * 三件事,全部通过包装 webServer 路由表 handler 实现(与 @xgone/dsh-remote 的
 * 网关同一机制,嵌套顺序无关):
 *
 *  1. 响应压缩:客户端 Accept-Encoding 允许时对文本类响应做 brotli(优先)/gzip,
 *     本地与远程一视同仁(remote 插件只对远程压缩,本地不压)。
 *     若响应已带 content-encoding(例如 dsh-remote 已压过)则绝不二次压缩。
 *  2. 缓存头:内容哈希资源(/assets/*、/plugins/*、rev= URL、favicon)下发
 *     `Cache-Control: public, max-age=31536000, immutable`。URL 含内容哈希,
 *     插件更新 → rev 变化 → 新 URL,浏览器自然换缓存;插件卸载 → 旧缓存条目
 *     失去引用,由浏览器自行回收,无需服务端做任何事。
 *     页面外壳/API/认证一律 no-store,保证清单与数据实时。
 *  3. 流量账本:按 key 统计每个响应的请求数 / 原始字节 / 线上字节(压缩后),
 *     持久化到 $DSH_HOME/storages/dsh-web-optimizer/ledger.json,
 *     经 GET /web-optimizer/ledger、POST /web-optimizer/reset 暴露给浏览器面板。
 *
 * key 规则:/plugins/<id>/... → plugin:<id>;/assets/* → frontend-core;
 * /api/<m> → api:<m>;/auth/* → auth;其余按路径归类。
 */
import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const name = 'web-optimizer'
const inject = ['webServer']

/** 包装标记,防止热重载时二次包装。 */
const WRAPPED = Symbol('dsh-web-optimizer.wrapped')
/** wrapped -> original,模块级保存,热重载卸载/重装可逆。 */
const wrappedOriginals = new Map()

// ── 压缩白名单 ────────────────────────────────────────────────────────────────
const COMPRESSIBLE_TYPES = new Set([
	'text/html',
	'text/css',
	'text/plain',
	'text/javascript',
	'text/markdown',
	'text/json',
	'application/javascript',
	'application/x-javascript',
	'application/json',
	'application/manifest+json',
	'application/wasm',
	'image/svg+xml',
])
const URL_EXT_FALLBACK = /\.(?:js|mjs|cjs|css|json|map|svg|html|txt|webmanifest)$/i

// ── 账本 ─────────────────────────────────────────────────────────────────────

function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh')
}
function ledgerFilePath() {
	return join(dshHome(), 'storages', 'dsh-web-optimizer', 'ledger.json')
}

function dayKey(atMs) {
	const d = new Date(atMs)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function createLedger() {
	const state = {
		version: 1,
		createdAt: Date.now(),
		updatedAt: 0,
		totals: { requests: 0, raw: 0, wire: 0 },
		keys: Object.create(null),
		days: Object.create(null),
	}
	let flushTimer = null

	function load() {
		try {
			const raw = readFileSync(ledgerFilePath(), 'utf8')
			const parsed = JSON.parse(raw)
			if (parsed && typeof parsed === 'object' && parsed.version === 1) {
				state.version = 1
				state.createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now()
				state.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
				if (parsed.totals && typeof parsed.totals === 'object') {
					state.totals = {
						requests: Number(parsed.totals.requests) || 0,
						raw: Number(parsed.totals.raw) || 0,
						wire: Number(parsed.totals.wire) || 0,
					}
				}
				if (parsed.keys && typeof parsed.keys === 'object') state.keys = parsed.keys
				if (parsed.days && typeof parsed.days === 'object') state.days = parsed.days
			}
		} catch {
			// 首次运行或文件损坏:从空账本开始。
		}
	}

	function persist() {
		try {
			const dir = join(dshHome(), 'storages', 'dsh-web-optimizer')
			mkdirSync(dir, { recursive: true })
			const tmp = ledgerFilePath() + '.tmp'
			writeFileSync(tmp, JSON.stringify(serialize(), null, 1))
			renameSync(tmp, ledgerFilePath())
		} catch (error) {
			if (typeof console !== 'undefined' && console.warn) {
				console.warn('[dsh-web-optimizer] 账本写入失败:', error?.message ?? error)
			}
		}
	}

	function serialize() {
		const keys = Object.keys(state.keys)
		if (keys.length > 400) {
			// 超长尾折叠,防止账本无限膨胀。
			keys.sort((a, b) => (state.keys[b]?.wire ?? 0) - (state.keys[a]?.wire ?? 0))
			const keep = keys.slice(0, 400)
			const rest = keys.slice(400)
			const overflow = { requests: 0, raw: 0, wire: 0, lastAt: 0, label: '长尾折叠' }
			for (const k of rest) {
				const e = state.keys[k]
				if (!e) continue
				overflow.requests += e.requests
				overflow.raw += e.raw
				overflow.wire += e.wire
				overflow.lastAt = Math.max(overflow.lastAt, e.lastAt)
				delete state.keys[k]
			}
			state.keys['other:long-tail'] = overflow
			void keep
		}
		const dayKeys = Object.keys(state.days).sort()
		if (dayKeys.length > 60) {
			for (const k of dayKeys.slice(0, dayKeys.length - 60)) delete state.days[k]
		}
		return { ...state }
	}

	function bump(key, label, raw, wire) {
		const at = Date.now()
		const entry = state.keys[key] ?? { requests: 0, raw: 0, wire: 0, lastAt: 0, label: key }
		if (typeof label === 'string' && label !== '') entry.label = label
		entry.requests += 1
		entry.raw += raw
		entry.wire += wire
		entry.lastAt = at
		state.keys[key] = entry
		state.totals.requests += 1
		state.totals.raw += raw
		state.totals.wire += wire
		const dk = dayKey(at)
		const day = state.days[dk] ?? { requests: 0, raw: 0, wire: 0 }
		day.requests += 1
		day.raw += raw
		day.wire += wire
		state.days[dk] = day
		state.updatedAt = at
		if (flushTimer === null) {
			flushTimer = setTimeout(() => {
				flushTimer = null
				persist()
			}, 1500)
			if (typeof flushTimer.unref === 'function') flushTimer.unref()
		}
	}

	function snapshot() {
		const now = Date.now()
		const entries = Object.entries(state.keys).map(([key, e]) => ({
			key,
			label: typeof e.label === 'string' && e.label !== '' ? e.label : key,
			requests: e.requests,
			raw: e.raw,
			wire: e.wire,
			saved: Math.max(0, e.raw - e.wire),
			lastAt: e.lastAt,
		}))
		entries.sort((a, b) => b.wire - a.wire)
		const totalWire = state.totals.wire
		for (const e of entries) {
			e.share = totalWire > 0 ? e.wire / totalWire : 0
		}
		const dayRows = Object.entries(state.days)
			.sort((a, b) => (a[0] < b[0] ? 1 : -1))
			.slice(0, 14)
			.map(([day, d]) => ({ day, requests: d.requests, raw: d.raw, wire: d.wire }))
		return {
			ok: true,
			version: 1,
			createdAt: state.createdAt,
			updatedAt: state.updatedAt,
			totals: { ...state.totals, saved: Math.max(0, state.totals.raw - state.totals.wire) },
			keys: entries,
			days: dayRows,
			meta: { now },
		}
	}

	function reset() {
		state.createdAt = Date.now()
		state.updatedAt = Date.now()
		state.totals = { requests: 0, raw: 0, wire: 0 }
		state.keys = Object.create(null)
		state.days = Object.create(null)
		persist()
	}

	function close() {
		if (flushTimer !== null) {
			clearTimeout(flushTimer)
			flushTimer = null
		}
		persist()
	}

	load()
	return { path: ledgerFilePath(), bump, snapshot, reset, close }
}

// ── 响应包装 ──────────────────────────────────────────────────────────────────

function pathnameOf(req) {
	try {
		return new URL(req.url ?? '/', 'http://x').pathname
	} catch {
		return '/'
	}
}

function contentTypeOf(headers) {
	if (headers && typeof headers['content-type'] === 'string') {
		return headers['content-type'].split(';')[0].trim().toLowerCase()
	}
	return ''
}

/** 缓存头规则:内容哈希资源长缓存 immutable,易变内容 no-store。 */
function cacheControlFor(pathname, url) {
	if (pathname.startsWith('/assets/') || pathname.startsWith('/plugins/')) return 'public, max-age=31536000, immutable'
	if (typeof url === 'string' && url.includes('rev=')) return 'public, max-age=31536000, immutable'
	if (pathname === '/favicon.svg') return 'public, max-age=31536000, immutable'
	if (pathname === '/' || pathname === '/index.html') return 'no-store'
	if (pathname.startsWith('/api') || pathname.startsWith('/auth') || pathname.startsWith('/web-optimizer')) return 'no-store'
	return null
}

/** 统计 key:/plugins/<id> → plugin:<id> 等。 */
function keyFor(pathname) {
	if (pathname === '/plugins' || pathname.startsWith('/plugins/')) {
		const parts = pathname.split('/').filter(Boolean)
		// 作用域包(@scope/name)占两段:路径 /plugins/@scope/name/client.js
		const id = parts[1] && parts[1].startsWith('@') ? (parts[1] + '/' + (parts[2] || '')) : (parts[1] || 'unknown')
		return { key: `plugin:${id}`, label: id }
	}
	if (pathname.startsWith('/assets/')) return { key: 'frontend-core', label: '核心前端' }
	if (pathname === '/api' || pathname.startsWith('/api/')) {
		const seg = pathname.slice(5).split('/')[0] || 'api'
		return { key: `api:${seg}`, label: `API · ${seg}` }
	}
	if (pathname === '/auth' || pathname.startsWith('/auth/')) return { key: 'auth', label: '登录认证' }
	if (pathname === '/web-optimizer' || pathname.startsWith('/web-optimizer/')) return { key: 'web-optimizer', label: '优化器 API' }
	if (pathname === '/') return { key: 'shell', label: '页面外壳' }
	if (pathname === '/favicon.svg' || pathname === '/manifest.webmanifest') return { key: 'misc', label: 'favicon/manifest' }
	return { key: 'other', label: '其他' }
}

function decideEncoding(req, status, headers, minBytes) {
	if (status === 204 || status === 206 || status === 304) return null
	const ae = String(req.headers['accept-encoding'] ?? '')
	const wantsBr = ae.indexOf('br') !== -1
	const wantsGzip = ae.indexOf('gzip') !== -1
	if (!wantsBr && !wantsGzip) return null
	if (headers && headers['content-encoding']) return null // 已压缩,绝不二次压缩
	const ctype = contentTypeOf(headers)
	if (ctype === 'text/event-stream') return null // SSE 流式,不缓冲
	let eligible = false
	if (ctype === '') {
		eligible = URL_EXT_FALLBACK.test(String(req.url ?? ''))
	} else {
		eligible = COMPRESSIBLE_TYPES.has(ctype)
	}
	if (!eligible) return null
	const len = headers && typeof headers['content-length'] === 'string' ? Number(headers['content-length']) : NaN
	if (Number.isFinite(len) && len >= 0 && len < minBytes) return null
	return wantsBr ? 'br' : 'gzip'
}

function addVary(existing, value) {
	if (!existing) return value
	const parts = String(existing).split(',').map((s) => s.trim()).filter(Boolean)
	if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) return parts.join(', ')
	parts.push(value)
	return parts.join(', ')
}

/**
 * 包装 node:http ServerResponse:延迟 emit,首写时决定压缩,
 * 记账 raw(进入 wrapper 的字节)/ wire(真正出 socket 的字节)。
 * 与 dsh-remote 的 makeGzipRes 互相嵌套安全(任一方先压,另一方看到
 * content-encoding 即跳过)。
 */
function makeMeasuringRes(res, req, ledger, minBytes) {
	const pathname = pathnameOf(req)
	const url = String(req.url ?? '')
	const k = keyFor(pathname)
	const cc = cacheControlFor(pathname, url)

	let status = 200
	let resolvedHeaders = null
	let decision = null // null | 'br' | 'gzip' | false
	let encStream = null
	let rawBytes = 0
	let wireBytes = 0
	let committed = false

	const emit = (finalHeaders) => {
		if (res.headersSent) return
		try {
			res.writeHead(status, finalHeaders)
		} catch {
			/* 连接已断 */
		}
	}

	const start = () => {
		if (decision !== null) return
		decision = decideEncoding(req, status, resolvedHeaders, minBytes)
		if (decision === 'br' || decision === 'gzip') {
			encStream = decision === 'br'
				? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
				: createGzip({ level: 6 })
			const out = {}
			for (const [key2, value] of Object.entries(resolvedHeaders ?? {})) {
				const lk = key2.toLowerCase()
				if (lk === 'content-length' || lk === 'transfer-encoding' || lk === 'connection' || lk === 'keep-alive') continue
				out[key2] = value
			}
			if (cc) out['cache-control'] = cc
			out['content-encoding'] = decision
			out['vary'] = addVary(out['vary'], 'Accept-Encoding')
			emit(out)
			encStream.on('error', () => {
				try { res.destroy() } catch { /* ignore */ }
			})
			encStream.on('data', (chunk) => {
				wireBytes += chunk.length
			})
			encStream.on('close', commit)
			encStream.pipe(res)
		} else {
			decision = false
			const out = Object.assign({}, resolvedHeaders ?? {})
			if (cc && !out['cache-control']) out['cache-control'] = cc
			emit(out)
		}
	}

	function commit() {
		if (committed) return
		committed = true
		ledger.bump(k.key, k.label, rawBytes, wireBytes)
	}

	const writeChunk = (chunk, encoding, cb) => {
		if (chunk) rawBytes += chunk.length
		if (encStream) {
			encStream.write(chunk, encoding, cb)
			return true
		}
		wireBytes += chunk ? chunk.length : 0
		return res.write(chunk, encoding, cb)
	}

	const wrapper = {
		writeHead(statusArg, headersArg, ...rest) {
			if (typeof statusArg === 'object' && statusArg !== null) {
				headersArg = statusArg
				statusArg = 200
			}
			status = statusArg
			const h = Object.assign({}, headersArg ?? {})
			if (cc && !h['cache-control']) h['cache-control'] = cc
			resolvedHeaders = Object.assign({}, resolvedHeaders ?? {}, h)
			return res
		},
		flushHeaders() {
			start()
			if (!encStream) res.flushHeaders()
			return res
		},
		write(chunk, encoding, cb) {
			start()
			return writeChunk(chunk, encoding, cb)
		},
		end(chunk, encoding, cb) {
			start()
			if (typeof encoding === 'function') {
				cb = encoding
				encoding = undefined
			}
			if (encStream) {
				if (chunk !== undefined && chunk !== null) rawBytes += chunk.length
				encStream.end(chunk, encoding, cb)
			} else {
				wireBytes += chunk ? chunk.length : 0
				if (chunk !== undefined && chunk !== null) return res.end(chunk, encoding, cb)
				return res.end(cb)
			}
			return res
		},
		destroy(...args) {
			if (encStream) {
				try { encStream.destroy() } catch { /* ignore */ }
			}
			commit()
			return res.destroy(...args)
		},
	}

	// close 兜底:响应完成(或连接中断)后结算。
	res.on('close', commit)

	return new Proxy(res, {
		get(target, prop, receiver) {
			if (prop in wrapper) return wrapper[prop]
			const value = Reflect.get(target, prop, receiver)
			return typeof value === 'function' ? value.bind(target) : value
		},
		set(target, prop, value, receiver) {
			return Reflect.set(target, prop, value, receiver)
		},
	})
}

// ── handler 包装 ──────────────────────────────────────────────────────────────

function wrapTraffic(handler, ledger, minBytes) {
	if (typeof handler !== 'function' || handler[WRAPPED]) return handler
	const wrapped = async (req, res) => {
		const outRes = makeMeasuringRes(res, req, ledger, minBytes)
		return handler(req, outRes)
	}
	Object.defineProperty(wrapped, WRAPPED, { value: true })
	wrappedOriginals.set(wrapped, handler)
	return wrapped
}

function unwrapTraffic(handler) {
	if (typeof handler !== 'function') return handler
	return wrappedOriginals.get(handler) ?? handler
}

// ── /web-optimizer HTTP 平面 ─────────────────────────────────────────────────────

function jsonOut(res, status, obj) {
	const body = JSON.stringify(obj)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	})
	res.end(body)
}

function readJsonBody(req, limitBytes) {
	return new Promise((resolvePromise) => {
		let size = 0
		const chunks = []
		req.on('data', (chunk) => {
			size += chunk.length
			if (size > limitBytes) {
				req.destroy()
				resolvePromise(null)
				return
			}
			chunks.push(chunk)
		})
		req.on('end', () => {
			if (chunks.length === 0) { resolvePromise({}); return }
			try {
				resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
			} catch {
				resolvePromise(null)
			}
		})
		req.on('error', () => resolvePromise(null))
	})
}

async function handleNetMeter(req, res, ledger) {
	const pathname = pathnameOf(req)
	if (pathname === '/web-optimizer/ledger' && req.method === 'GET') {
		jsonOut(res, 200, ledger.snapshot())
		return
	}
	if (pathname === '/web-optimizer/reset' && req.method === 'POST') {
		await readJsonBody(req, 4096)
		ledger.reset()
		jsonOut(res, 200, { ok: true })
		return
	}
	jsonOut(res, 404, { ok: false, error: 'not found' })
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

const MIN_BYTES = 512

function apply(ctx, config) {
	const webServer = ctx.webServer
	const minBytes = Number(config?.minBytes ?? MIN_BYTES) || MIN_BYTES
	const ledger = createLedger()
	if (typeof console !== 'undefined' && console.log) {
		console.log(`[dsh-web-optimizer] 已加载,账本:${ledger.path}`)
	}

	const originalRegister = webServer.register.bind(webServer)

	const wrapAll = () => {
		for (const route of webServer.exact.values()) route.handler = wrapTraffic(route.handler, ledger, minBytes)
		for (const route of webServer.prefixes.values()) route.handler = wrapTraffic(route.handler, ledger, minBytes)
		if (webServer.fallback !== undefined) webServer.fallback = wrapTraffic(webServer.fallback, ledger, minBytes)
	}

	wrapAll()
	webServer.register = (route) => originalRegister({ ...route, handler: wrapTraffic(route.handler, ledger, minBytes) })

	// /web-optimizer 平面(经当前 register,若 remote 网关在则会一并加认证)。
	const disposeRoute = webServer.register({
		kind: 'prefix',
		path: '/web-optimizer',
		handler: (req, res) => handleNetMeter(req, res, ledger),
	})

	ctx.effect(() => () => {
		try {
			disposeRoute()
		} catch { /* 已移除 */ }
		webServer.register = originalRegister
		for (const route of webServer.exact.values()) route.handler = unwrapTraffic(route.handler)
		for (const route of webServer.prefixes.values()) route.handler = unwrapTraffic(route.handler)
		if (webServer.fallback !== undefined) webServer.fallback = unwrapTraffic(webServer.fallback)
		ledger.close()
	}, 'web-optimizer: dispose')
}

export { name, inject, apply }
export default { name, inject, apply }
