/**
 * Qianwen AI platform bridge.
 *
 * Everything quota-, account- and catalog-shaped on platform.qianwenai.com lives
 * behind the management API, not the OpenAI-compatible endpoint: the compatible
 * `/models` route is explicitly unavailable (the provider's own FAQ says the
 * "Fetch available models" button may be ignored) and there is no public quota
 * route at all. The sanctioned client is the official `@qianwenai/qianwen-cli`,
 * which speaks a signed Aliyun-style RPC that is not worth re-implementing, so
 * this module drives that CLI as a child process and parses its `--format json`
 * output.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Package name of the official CLI, resolved the same way the shell would. */
const CLI_PACKAGE = '@qianwenai/qianwen-cli'
const CLI_ENTRY = 'dist/bin/qianwen.js'

/**
 * Data directory for this plugin.
 *
 * Precedence: an explicit environment override, the profile directory the host
 * reports through `profileContext`, the same directory derived from the launch
 * environment, then the harness home. The derived forms exist because a server
 * started by a launcher carries no `DSH_PROFILE*` variables at all, and a cache
 * that moved between restarts would re-run the CLI on every page open.
 */

/** Profile directory reported by the host; empty until `bindProfileDir` runs. */
let boundProfileDir = ''

/**
 * Record the profile directory the host reports.
 * @param dir - absolute profile directory, ignored when blank.
 */
export function bindProfileDir(dir) {
  if (typeof dir === 'string' && dir.trim() !== '') boundProfileDir = dir.trim()
}

export function dataDir() {
  const explicit = process.env['DSH_QIANWEN_DATA_DIR']
  if (explicit !== undefined && explicit.trim() !== '') return explicit.trim()
  const profileDir = boundProfileDir !== '' ? boundProfileDir : process.env['DSH_PROFILE_DIR']
  if (profileDir !== undefined && profileDir.trim() !== '') return join(profileDir.trim(), 'data', 'dsh-qianwen')
  const home = process.env['DSH_HOME']
  const base = home !== undefined && home.trim() !== '' ? home.trim() : join(homedir(), '.dsh')
  const profile = process.env['DSH_PROFILE']
  if (profile !== undefined && profile.trim() !== '') {
    const candidate = join(base, 'profiles', profile.trim(), 'data', 'dsh-qianwen')
    if (existsSync(join(base, 'profiles', profile.trim()))) return candidate
  }
  return join(base, 'data', 'dsh-qianwen')
}

/** Directory the plugin owns for its managed CLI install. */
export function cliDir() {
  return join(dataDir(), 'cli')
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function writeJsonFile(path, value) {
  try {
    ensureDir(join(path, '..'))
    writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Locate an executable on PATH without shelling out. */
function whichOnPath(bin) {
  const path = process.env['PATH'] ?? ''
  for (const dir of path.split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the CLI entry, most specific first: an explicit setting, the profile's
 * own node_modules, this plugin's managed install, then whatever PATH offers.
 * @returns `{command, args}` for spawning, or `undefined` when nothing is installed.
 */
export function resolveCli(configured) {
  const entries = []
  if (typeof configured === 'string' && configured.trim() !== '') entries.push(configured.trim())
  const profile = process.env['DSH_PROFILE_DIR']
  if (profile !== undefined && profile !== '') {
    entries.push(join(profile, 'node_modules', CLI_PACKAGE, CLI_ENTRY))
  }
  entries.push(join(dataDir(), 'cli', 'node_modules', CLI_PACKAGE, CLI_ENTRY))
  for (const entry of entries) {
    if (existsSync(entry)) return { command: process.execPath, args: [entry] }
  }
  const onPath = whichOnPath('qianwen')
  if (onPath !== undefined) return { command: onPath, args: [] }
  return undefined
}

/** Pull the first JSON document out of mixed stdout (warnings, banners, colour). */
export function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const ANSI = /\u001b\[[0-9;]*m/g

/**
 * Run one CLI command and parse its JSON payload.
 *
 * The CLI answers failures with a payload of its own (`AUTH_REQUIRED`,
 * `QUOTA_EXHAUSTED`, …) and a non-zero exit code, so the body is parsed before
 * the exit code is judged: a structured error is far more useful to the caller
 * than "exit 2".
 */
export function runCli(cli, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CI: '1',
    TERM: 'dumb',
    ...options.env,
  }
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child
    try {
      child = spawn(cli.command, [...cli.args, ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      resolve({ ok: false, error: { code: 'SPAWN_FAILED', message: String(error?.message ?? error) } })
      return
    }
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      finish({ ok: false, error: { code: 'TIMEOUT', message: `qianwen ${args.join(' ')} timed out after ${timeoutMs}ms` } })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      finish({ ok: false, error: { code: 'SPAWN_FAILED', message: String(error?.message ?? error) } })
    })
    child.on('close', (code) => {
      const text = stdout.replace(ANSI, '')
      const json = extractJson(text)
      if (json !== undefined && json !== null) {
        finish({ ok: true, exitCode: code, data: json, stderr: stderr.replace(ANSI, '') })
        return
      }
      finish({
        ok: false,
        exitCode: code,
        error: {
          code: code === 0 ? 'UNPARSABLE_OUTPUT' : `EXIT_${code ?? 'UNKNOWN'}`,
          message: (stderr.replace(ANSI, '').trim() || text.trim() || 'no output').slice(0, 800),
        },
      })
    })
  })
}

/* -------------------------------------------------------------------------- */
/* Payload shapes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Normalize `models list --verbose` into the rows this plugin serves.
 *
 * The catalog reports every modality (text, image, video, audio, embedding), so
 * only models that take text in and produce text out are kept: those are the
 * only ones the chat-completions provider route can serve. Prices arrive in
 * CNY per million tokens, tiered for models whose long-context window costs
 * more, and the first tier is the one a normal turn pays.
 */
export function buildCatalog(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : []
  const rows = []
  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id : undefined
    if (id === undefined) continue
    const input = Array.isArray(model?.modality?.input) ? model.modality.input : []
    const output = Array.isArray(model?.modality?.output) ? model.modality.output : []
    const tiers = Array.isArray(model?.pricing?.tiers) ? model.pricing.tiers : []
    const first = tiers[0]
    const billing = model?.pricing?.summary?.billing_type
    if (!input.includes('text') || !output.includes('text')) continue
    if (billing !== undefined && billing !== 'token') continue
    const tags = Array.isArray(model?.tags) ? model.tags : []
    const tierPrices = tiers
      .map((tier) => ({
        label: typeof tier?.label === 'string' ? tier.label : '',
        input: numberOr(tier?.input, 0),
        output: numberOr(tier?.output, 0),
        cacheCreation: numberOr(tier?.cache_creation, 0),
        cacheRead: numberOr(tier?.cache_read, 0),
        unit: typeof tier?.unit === 'string' ? tier.unit : 'CNY/1M tokens',
      }))
      .filter((tier) => tier.input > 0 || tier.output > 0)
    if (tierPrices.length === 0) continue
    rows.push({
      id,
      description: typeof model?.description === 'string' ? model.description : '',
      tags,
      reasoning: tags.includes('Reasoning'),
      vision: input.includes('image'),
      input,
      output,
      features: Array.isArray(model?.features) ? model.features : [],
      tiers: tierPrices,
      price: tierPrices[0],
      contextWindow: numberOr(model?.context?.context_window, 0),
      maxInput: numberOr(model?.context?.max_input, 0),
      maxOutput: numberOr(model?.context?.max_output, 0),
      rpm: numberOr(model?.rate_limits?.rpm, 0),
      versionTag: typeof model?.metadata?.version_tag === 'string' ? model.metadata.version_tag : '',
      openSource: model?.metadata?.open_source === true,
      updated: typeof model?.metadata?.updated === 'string' ? model.metadata.updated : '',
      category: typeof model?.metadata?.category === 'string' ? model.metadata.category : '',
      cheapestInput: numberOr(model?.pricing?.summary?.cheapest_input, tierPrices[0].input),
      cheapestOutput: numberOr(model?.pricing?.summary?.cheapest_output, tierPrices[0].output),
    })
  }
  return rows
}

function numberOr(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

/**
 * Platform-wide floor price for text input, used when no baseline model is
 * chosen: one credit is one fen (see {@link CREDITS_PER_YUAN}), and the cheapest
 * chat model on the platform is the natural "1×" of a multiplier column.
 */
export function baselineOf(rows) {
  let floor = Number.POSITIVE_INFINITY
  for (const row of rows) if (row.price.input > 0) floor = Math.min(floor, row.price.input)
  return Number.isFinite(floor) ? floor : 1
}

/**
 * Decorate every model with the multiplier column.
 *
 * A credit is one fen: the platform's own worked example (qwen3.6-plus, 8,349
 * input tokens → 1.67 credits, 40,794 cached → 0.82, 573 output → 0.69) lands on
 * 0.01 CNY per credit whichever of the three prices it is computed from. The
 * platform publishes no "multiplier" field of its own, so this column is derived
 * here — model price ÷ baseline price — and the UI says so next to the header.
 */
export const CREDITS_PER_YUAN = 100

export function withMultipliers(rows, baselineId) {
  // Without a chosen reference model the cheapest one is the anchor, and using
  // one row for both directions keeps the two multiplier columns comparable:
  // dividing input prices by one model and output prices by another produces a
  // table where a column cannot be read as "relative to the same thing".
  const cheapest = rows.reduce(
    (best, row) => (row.price.input > 0 && (best === undefined || row.price.input < best.price.input) ? row : best),
    undefined,
  )
  const chosen = baselineId === undefined ? undefined : rows.find((row) => row.id === baselineId)
  const reference = chosen ?? cheapest
  const baseInput = reference !== undefined && reference.price.input > 0 ? reference.price.input : baselineOf(rows)
  const baseOutput = reference !== undefined && reference.price.output > 0 ? reference.price.output : undefined
  const out = rows.map((row) => {
    const inputMult = baseInput > 0 ? row.price.input / baseInput : 0
    const outputMult = baseOutput !== undefined && baseOutput > 0 ? row.price.output / baseOutput : undefined
    return {
      ...row,
      multiplier: {
        input: round2(inputMult),
        output: outputMult === undefined ? undefined : round2(outputMult),
      },
      creditsPerMillionInput: Math.round(row.price.input * CREDITS_PER_YUAN),
      creditsPerMillionOutput: Math.round(row.price.output * CREDITS_PER_YUAN),
    }
  })
  return { models: out, baseline: { id: chosen?.id, input: baseInput, output: baseOutput } }
}

function round2(value) {
  return Math.round(value * 100) / 100
}