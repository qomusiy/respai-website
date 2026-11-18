/** Talking to the RespAI analysis server (ai-server/ on the team's laptop). */

export const DEFAULT_SERVER = 'http://localhost:8787'
const KEY = 'respai-server'

/**
 * The analysis server runs on the team's laptop behind a free Cloudflare tunnel whose address
 * changes when the laptop restarts. ai-server/tunnel.py publishes the current address to this
 * secret gist; the dashboard looks it up there.
 */
const DIRECTORY_API = 'https://api.github.com/gists/d311355c4a77112401690051ded258d1'
const DIRECTORY_RAW = 'https://gist.githubusercontent.com/qomusiy/d311355c4a77112401690051ded258d1/raw/respai-server.json'
const DIRECTORY_FILE = 'respai-server.json'

const clean = (u: string) => u.trim().replace(/\/+$/, '')
const onThisLaptop = () => ['localhost', '127.0.0.1'].includes(location.hostname)

/** A manually chosen address: ?server=… in the URL, or one saved in "Server address". */
export function getOverride(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get('server')
    if (fromUrl) return clean(fromUrl)
    const saved = localStorage.getItem(KEY)
    return saved ? clean(saved) : null
  } catch {
    return null
  }
}

export function setOverride(url: string | null) {
  try {
    if (url) localStorage.setItem(KEY, clean(url))
    else localStorage.removeItem(KEY)
  } catch {
    // not persisted
  }
}

/** Current public address from the directory, or null if the server is marked offline. */
async function lookupDirectory(): Promise<string | null> {
  const parse = (text: string) => {
    const d = JSON.parse(text) as { url?: string | null }
    return d.url ? clean(d.url) : null
  }
  try {
    const r = await fetch(DIRECTORY_API, { cache: 'no-store' })
    if (r.ok) {
      const g = (await r.json()) as { files?: Record<string, { content?: string }> }
      return parse(g.files?.[DIRECTORY_FILE]?.content ?? '{}')
    }
  } catch {
    // fall through to the raw file (no rate limit, but cached for a few minutes)
  }
  const r = await fetch(`${DIRECTORY_RAW}?t=${Math.floor(Date.now() / 60000)}`)
  return parse(await r.text())
}

/** Where to send analyses, in order of preference. */
export async function resolveServers(): Promise<string[]> {
  const override = getOverride()
  if (override) return [override]
  const list: string[] = []
  try {
    const url = await lookupDirectory()
    if (url) list.push(url)
  } catch {
    // directory unreachable
  }
  if (onThisLaptop()) list.push(DEFAULT_SERVER)
  return list
}

export interface HeadMetrics {
  balanced_accuracy: number
  auc?: number
  n: number
}
export interface Metrics {
  trained: string
  dataset: string
  evaluation: string
  cough: HeadMetrics
  type: HeadMetrics
  condition: HeadMetrics & { chance: number; auc_macro_ovr: number; illness_auc: number; recall: Record<string, number>; counts: Record<string, number> }
}
export interface Health {
  status: 'ready' | 'loading' | 'error'
  version: string
  error: string | null
  metrics: Metrics | Record<string, never>
}

export interface Analysis {
  ok: true
  is_cough: boolean
  cough_probability: number
  illness_probability: number
  condition: Record<string, number>
  cough_type: Record<string, number>
  audio: { seconds: number; windows: number; rms_db: number }
  ms: number
}
export type AnalyzeResponse = Analysis | { ok: false; reason: 'silent'; seconds: number }

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const c = new AbortController()
  const id = setTimeout(() => c.abort(), ms)
  try {
    return await p(c.signal)
  } finally {
    clearTimeout(id)
  }
}

export async function fetchHealth(server: string): Promise<Health> {
  return withTimeout(async (signal) => {
    const r = await fetch(`${server}/api/health`, { signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()) as Health
  }, 4000)
}

export class ServerError extends Error {}

export async function analyze(server: string, audio: Blob, filename: string): Promise<AnalyzeResponse> {
  const body = new FormData()
  body.append('audio', audio, filename)
  return withTimeout(async (signal) => {
    const r = await fetch(`${server}/api/analyze`, { method: 'POST', body, signal })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new ServerError((data as { detail?: string }).detail || `HTTP ${r.status}`)
    return data as AnalyzeResponse
  }, 60000)
}
