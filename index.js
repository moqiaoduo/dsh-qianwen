/**
 * Qianwen AI platform (platform.qianwenai.com) integration for DeepSeek Harness.
 *
 * Four things the platform does not hand you through its OpenAI-compatible
 * endpoint are assembled here and served to the browser half over one loopback
 * route table: the two provider routes themselves, the model catalog with a
 * credits-multiplier column, the remaining Token Plan credits, and the on/off +
 * level control for thinking mode.
 *
 * The routes are REGISTERED by this plugin rather than written into the
 * installed pi-ai adapter's configuration. Writing them there made them the
 * models page's property: it could rename a route's endpoint, empty its model
 * list, or delete it, and the host has no read-only provider to stop it. A
 * route registered through `ctx.llm.registerAdapter()` with an empty
 * `settingsPath` cannot be deleted at all, and its models come from the CLI
 * catalog rather than from a settings document.
 *
 * Everything account- or catalog-shaped comes from the official
 * `@qianwenai/qianwen-cli`, including the login: the CLI's device flow is
 * two-stage (`--init-only` returns a verification link, `--complete` polls), so
 * the page can carry a user from "not signed in" to "signed in" without a
 * terminal.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

import {
  bindProfileDir,
  buildCatalog,
  cliDir,
  dataDir,
  readJsonFile,
  resolveCli,
  runCli,
  withMultipliers,
  writeJsonFile,
} from './lib/qwen.js'
import {
  PAYG,
  PROVIDERS,
  TOKEN_PLAN,
  QianwenAdapter,
  channelFor,
  channels,
  directoryEntries,
  enabledRows,
  familyOf,
  kindsOf,
  profilesFor,
} from './lib/providers.js'
import { clearKey, describeKey, writeKey } from './lib/credentials.js'

/** Route prefix served on the local web server. */
const ROUTE_BASE = '/plugins/dsh-qianwen'

/** Settings section id, also the icon's address and the fallback namespace. */
export const SETTINGS_SECTION_ID = 'dsh-qianwen'

/** Directory the pi-ai routes used to be written into, before this plugin owned them. */
const LEGACY_NAMESPACE = 'llm-pi-ai'

/**
 * Plugin configuration.
 *
 * Every field is `volatile`: the host can rewrite these values while the
 * plugin keeps running, and the page, the routes and the credential references
 * all read them per use instead of caching them at mount time. A settings
 * change therefore never remounts the plugin (which would drop in-flight
 * requests) and never needs a restart to reach the next model call.
 */
export const Config = z.object({
  cliPath: z
    .string()
    .default('')
    .volatile()
    .description('Path to the qianwen CLI executable or its dist entry. Empty means: resolve it automatically.'),
  tokenPlanApiKeyEnv: z
    .string()
    .default('QIANWEN_TOKEN_PLAN_API_KEY')
    .volatile()
    .description('Credential reference that holds the Token Plan API key (a `sk-sp-` key).'),
  paygApiKeyEnv: z
    .string()
    .default('QIANWEN_PAYG_API_KEY')
    .volatile()
    .description('Credential reference that holds the pay-as-you-go API key (a `sk-ws-` key).'),
  thinkingMode: z
    .union([z.const('auto'), z.const('off')])
    .default('auto')
    .volatile()
    .description('`auto` declares thinking on the models whose catalog tags carry it; `off` declares none anywhere.'),
  refreshMinutes: z
    .number()
    .step(1)
    .min(1)
    .default(10)
    .volatile()
    .description('How often the credit balance is re-read, in minutes.'),
  catalogRefreshMinutes: z
    .number()
    .step(1)
    .min(1)
    .default(360)
    .volatile()
    .description('How old the model catalog may get before the background loop rebuilds it, in minutes.'),
  tokenPlanDisabledModels: z
    .array(z.string())
    .default([])
    .volatile()
    .description('Catalog model ids kept out of the Token Plan route. Empty means every model the catalog lists.'),
  paygDisabledModels: z
    .array(z.string())
    .default([])
    .volatile()
    .description('Catalog model ids kept out of the pay-as-you-go route. Empty means every model the catalog lists.'),
  defaultThinkingEffort: z
    .union([z.const(''), z.const('off'), z.const('low'), z.const('medium'), z.const('high')])
    .default('')
    .volatile()
    .description('Thinking level requests start from. Empty keeps the level the picker last used on that route.'),
  rememberThinkingEffort: z
    .boolean()
    .default(true)
    .volatile()
    .description('Adopt a thinking level you pick in the model picker as the route default.'),
})

/**
 * Inert pi-ai auth plane.
 *
 * Both routes authenticate through a credential reference this plugin resolves
 * per request, so pi-ai's own credential lifecycle and ambient file/env
 * discovery must never manufacture a credential for them — a stale login from
 * some other tool must not silently become the Qianwen API key.
 */
const INERT_AUTH = {
  credentials: {
    read() {},
    list() {
      return []
    },
    modify() {
      throw new Error('dsh-qianwen routes do not store pi-ai credentials')
    },
    delete() {},
  },
  authContext: {
    env() {},
    fileExists() {
      return false
    },
  },
}

/** Unwrap one config field: volatile fields answer `get()`, plain ones the value. */
function readField(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value
}

function log(ctx, level, message) {
  const logger = ctx?.logger
  const fn = logger?.[level]
  if (typeof fn === 'function') fn.call(logger, `dsh-qianwen: ${message}`)
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Fallback guard for profiles that do not mount the host Connection service.
 *
 * The routes carry plan credits and can store API keys, so a page on another
 * origin must not reach them. The preferred check is the host's
 * `connection.requestRejection`, which also defends DNS rebinding and cross-site
 * requests; a bare loopback socket check cannot tell those apart. This remains
 * only as a last resort when no Connection service is available.
 */
function requireLoopback(req, res) {
  const address = req.socket?.remoteAddress ?? ''
  const ok = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  if (!ok) {
    json(res, 403, { error: 'loopback only' })
    return false
  }
  return true
}

/** Host Connection service, or undefined on profiles that do not mount one. */
function connectionOf(ctx) {
  try {
    // Hosts expose it either as a direct ctx property or as a cordis service.
    const connection = Reflect.get(ctx, 'connection') ?? ctx.get?.('connection')
    return connection && typeof connection.requestRejection === 'function' ? connection : undefined
  } catch {
    return undefined
  }
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** The settings service, or `undefined` while the profile does not mount one. */
function settingsService(ctx) {
  try {
    return ctx.get?.('settings')
  } catch {
    return undefined
  }
}

/** Thinking levels this plugin offers, in ascending order. */
const EFFORTS = ['off', 'low', 'medium', 'high']

/** One stored or configured level, or `undefined` when it names nothing. */
function normalizeEffort(value) {
  return EFFORTS.includes(value) ? value : undefined
}

/** A string array out of a config value, tolerating a comma-separated string. */
function readList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '')
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
  }
  return []
}

export const name = 'dsh-qianwen'
export const inject = ['webServer', 'llm']

export function apply(ctx, config) {
  // The profile owns the data directory, and `profileContext` is the service
  // that knows where it is. The environment is only a fallback: a server
  // started by a launcher carries neither `DSH_PROFILE_DIR` nor `DSH_PROFILE`,
  // and without this the plugin would scatter its cache into `~/.dsh/data`.
  try {
    const profileDir = ctx.get?.('profileContext')?.dir
    if (typeof profileDir === 'string' && profileDir.trim() !== '') bindProfileDir(profileDir.trim())
  } catch {}

  /** Current plugin settings, read live so a host-side edit lands on the next call. */
  const settings = () => ({
    cliPath: readField(config?.cliPath) ?? '',
    tokenPlanApiKeyEnv: readField(config?.tokenPlanApiKeyEnv) ?? 'QIANWEN_TOKEN_PLAN_API_KEY',
    paygApiKeyEnv: readField(config?.paygApiKeyEnv) ?? 'QIANWEN_PAYG_API_KEY',
    thinkingMode: readField(config?.thinkingMode) === 'off' ? 'off' : 'auto',
    refreshMinutes: Math.max(1, Number(readField(config?.refreshMinutes)) || 10),
    catalogRefreshMinutes: Math.max(1, Number(readField(config?.catalogRefreshMinutes)) || 360),
    disabledModels: {
      [TOKEN_PLAN]: readList(readField(config?.tokenPlanDisabledModels)),
      [PAYG]: readList(readField(config?.paygDisabledModels)),
    },
    defaultThinkingEffort: normalizeEffort(readField(config?.defaultThinkingEffort)),
    rememberThinkingEffort: readField(config?.rememberThinkingEffort) !== false,
  })

  /**
   * Namespace this plugin's config lives under.
   *
   * The host matches a configurable provider to its settings section by the
   * profile ENTRY id, not by the package name, and an entry that came from a
   * bundle can be renamed (`include:dsh-qianwen`). Reading it off the running
   * fiber keeps the two in step; the constant is only a fallback for a context
   * with no entry (the test harness).
   */
  const settingsNamespace = (() => {
    try {
      const id = ctx.fiber?.entry?.options?.id
      return typeof id === 'string' && id !== '' ? id : SETTINGS_SECTION_ID
    } catch {
      return SETTINGS_SECTION_ID
    }
  })()

  const dir = dataDir()
  const catalogPath = join(dir, 'catalog.json')
  /** Route defaults learned from the model picker: `{ [provider]: effort }`. */
  const effortPath = join(dir, 'effort.json')

  /** Last catalog build, kept across restarts so the picker has models at boot. */
  let catalog = readJsonFile(catalogPath)

  /** Levels the picker chose per route, persisted so they survive a restart. */
  let learnedEffort = readJsonFile(effortPath) ?? {}

  const state = {
    auth: undefined,
    subscription: undefined,
    usage: undefined,
    balance: undefined,
    /** Undecorated catalog rows; the multiplier column is derived per settings. */
    raw: catalog?.raw,
    models: catalog?.models,
    baseline: catalog?.baseline,
    refreshedAt: catalog?.refreshedAt,
    error: undefined,
    refreshing: false,
    login: undefined,
    cliInstall: undefined,
    /** Why the provider routes could not be registered, if they could not. */
    routesError: undefined,
    /** Whether both routes are live right now; registration is deferred. */
    routesReady: false,
  }

  /** Retry policy both routes report; the host's defaults with a label for diagnostics. */
  const retryPolicy = resolveRetryPolicy(undefined, 'dsh-qianwen retryPolicy')

  /** Credential service, or `undefined` before the profile mounts one. */
  const credentials = () => {
    try {
      return ctx.get?.('credentials')
    } catch {
      return undefined
    }
  }

  /**
   * Resolve one route's API key.
   *
   * A missing key throws `MISSING_CREDENTIAL` rather than returning
   * `undefined`: the adapter turns that into an EMPTY model list for the route,
   * which is what makes an unconfigured channel show as "no models" instead of
   * offering models whose every request would fail.
   */
  const resolveKey = async (channel) => {
    const service = credentials()
    if (service === undefined) {
      throw new LlmError('the credential service is not available in this profile', 'MISSING_CREDENTIAL')
    }
    const resolved = await service.resolve(channel.apiKeyEnv)
    const value = resolved?.value
    if (typeof value !== 'string' || value === '') {
      throw new LlmError(`no API key is stored for "${channel.apiKeyEnv}"`, 'MISSING_CREDENTIAL')
    }
    return value
  }

  /**
   * The level a route's requests start from.
   *
   * An explicit setting wins over what the picker taught us, because a user who
   * wrote a level down wants it to hold even after they try another one; an
   * empty setting means "whatever that route was last used with".
   */
  const effortFor = (provider) =>
    normalizeEffort(settings().defaultThinkingEffort) ?? normalizeEffort(learnedEffort?.[provider])

  /**
   * The adapter's current profile map.
   *
   * Replaced (never mutated) whenever the catalog or a model-shaping setting
   * changes: `PiAiAdapter` recognizes a new configuration by this map's
   * identity, so a fresh Map is what makes it rebuild its model collection.
   */
  let profiles = profilesFor(Array.isArray(state.models) ? state.models : [], settings(), {
    resolveKey,
    retryPolicy,
    effortOf: effortFor,
  })

  const adapter = new QianwenAdapter(
    {
      profiles: () => profiles,
      resolveApiKey: async (provider) => {
        const channel = channelFor(settings(), provider)
        if (channel === undefined) {
          throw new LlmError(`dsh-qianwen does not own provider "${provider}"`, 'NO_ADAPTER')
        }
        return resolveKey(channel)
      },
      auth: INERT_AUTH,
      // Image input travels through the host's durable attachment service; the
      // adapter refuses image content when it cannot reach one, which is the
      // honest answer for a profile that mounts none.
      resolveAttachments: () => {
        try {
          return ctx.get?.('attachments')
        } catch {
          return undefined
        }
      },
    },
    // The guard subclass needs the same route-level default the profiles carry,
    // to tell "the caller asked for this level" from "the route defaults to it".
    (provider) => effortFor(provider),
  )

  /** Tell pickers to re-read one route's model list. */
  const announce = (provider) => {
    try {
      ctx.emit('llm/models-updated', provider)
    } catch (error) {
      log(ctx, 'warn', `could not announce ${provider}: ${String(error?.message ?? error)}`)
    }
  }

  /** Rebuild both routes from the current catalog and settings. */
  const rebuildRoutes = () => {
    const current = settings()
    // The full catalog goes in; each channel drops its own deny-list inside.
    profiles = profilesFor(Array.isArray(state.models) ? state.models : [], current, {
      resolveKey,
      retryPolicy,
      effortOf: effortFor,
    })
    for (const provider of PROVIDERS) announce(provider)
  }

  /**
   * Drop the routes an earlier version of this plugin wrote into the pi-ai
   * settings section.
   *
   * Leaving them behind would be worse than untidy: the installed pi-ai adapter
   * still owns those provider ids, so `registerAdapter` below would refuse the
   * whole registration as a duplicate. Unsetting an absent path is skipped
   * instead of issued, because a needless write rewrites the profile patch file
   * on every boot.
   */
  const unlinkLegacyRoutes = async () => {
    const service = settingsService(ctx)
    if (service === undefined) return false
    let providers
    try {
      const descriptors = service.describe({ redactSecrets: true })
      if (!Array.isArray(descriptors)) return false
      const descriptor = descriptors.find((item) => item?.ns === LEGACY_NAMESPACE)
      providers = descriptor?.value?.providers
    } catch {
      return false
    }
    if (providers === undefined || providers === null || typeof providers !== 'object') return false
    const present = PROVIDERS.filter((provider) => Object.hasOwn(providers, provider))
    if (present.length === 0) return false
    try {
      await service.mutate(
        LEGACY_NAMESPACE,
        present.map((provider) => ({ op: 'unset', path: ['providers', provider] })),
      )
      log(ctx, 'info', `removed the routes the previous version wrote into ${LEGACY_NAMESPACE}: ${present.join(', ')}`)
      return true
    } catch (error) {
      log(ctx, 'warn', `could not remove the legacy routes: ${String(error?.message ?? error)}`)
      return false
    }
  }

  /**
   * Whether a registration failure is only the startup race.
   *
   * The code is read off the error instead of testing `instanceof LlmError`: the
   * error comes from the host's copy of `@deepseek-ai/dsh-llm`, and a profile
   * that ever ships its own copy would make the class check quietly false and
   * turn a recoverable race into a permanent "routes failed" state.
   */
  const isDuplicate = (error) => {
    const code = error?.code
    return code === 'DUPLICATE_ADAPTER' || code === 'DUPLICATE_DIRECTORY'
  }

  /**
   * Register both routes and their directory entries.
   *
   * The duplicate case is a startup race with the unlink above: releasing a
   * route from the settings section is asynchronous inside the host, so the
   * first attempt can still lose to the pi-ai adapter that has not let go yet.
   * Retrying with a short backoff converges once that adapter reconciles.
   */
  const registerRoutes = async () => {
    await unlinkLegacyRoutes()
    let lastError
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const releaseAdapter = ctx.llm.registerAdapter([...PROVIDERS], adapter)
        let releaseDirectory
        try {
          releaseDirectory = ctx.llm.registerConfigurableProviders(
            directoryEntries(settingsNamespace, settings()),
          )
        } catch (error) {
          releaseAdapter()
          throw error
        }
        state.routesError = undefined
        state.routesReady = true
        log(ctx, 'info', `provider routes registered: ${PROVIDERS.join(', ')} (settings ${settingsNamespace})`)
        return {
          dispose: () => {
            state.routesReady = false
            try {
              releaseDirectory()
            } catch {}
            try {
              releaseAdapter()
            } catch {}
          },
        }
      } catch (error) {
        lastError = error
        if (!isDuplicate(error)) break
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
    state.routesError = String(lastError?.message ?? lastError)
    log(ctx, 'error', `provider routes could not be registered: ${state.routesError}`)
    return { dispose: () => {} }
  }

  /**
   * Install the official CLI into this plugin's data directory.
   *
   * The alternative — telling every user to run `npm i -g` themselves — turns
   * one click into a terminal session plus a shell-rc edit, and a global install
   * the plugin cannot verify. A private prefix keeps the dependency of the
   * feature next to the feature, and `resolveCli` prefers it automatically.
   */
  const installCli = async () => {
    if (state.cliInstall?.status === 'running') return state.cliInstall
    state.cliInstall = { status: 'running', message: undefined, startedAt: new Date().toISOString() }
    const target = cliDir()
    try {
      mkdirSync(target, { recursive: true })
    } catch {}
    const result = await new Promise((resolve) => {
      let output = ''
      let child
      try {
        child = spawn('npm', ['i', '@qianwenai/qianwen-cli@1', '--prefix', target, '--no-audit', '--no-fund', '--loglevel=error'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        })
      } catch (error) {
        resolve({ ok: false, message: String(error?.message ?? error) })
        return
      }
      child.stdout?.on('data', (chunk) => {
        output += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        output += String(chunk)
      })
      child.on('error', (error) => resolve({ ok: false, message: String(error?.message ?? error) }))
      child.on('close', (code) => resolve({ ok: code === 0, message: output.trim().slice(-600) }))
    })
    state.cliInstall = {
      status: result.ok ? 'done' : 'failed',
      message: result.message,
      finishedAt: new Date().toISOString(),
    }
    if (result.ok) {
      log(ctx, 'info', `qianwen CLI installed under ${target}`)
      void refreshAll()
    }
    return state.cliInstall
  }

  const cli = () => resolveCli(settings().cliPath)

  /** One CLI call with the plugin's standard timeout and error shape. */
  const call = async (args, timeoutMs) => {
    const resolved = cli()
    if (resolved === undefined) {
      return {
        ok: false,
        error: {
          code: 'CLI_MISSING',
          message: 'qianwen CLI not found. Install it with: npm i -g @qianwenai/qianwen-cli',
        },
      }
    }
    return runCli(resolved, args, { timeoutMs })
  }

  /* ------------------------------------------------------------------ */
  /* Account                                                            */
  /* ------------------------------------------------------------------ */

  const refreshAuth = async () => {
    const result = await call(['auth', 'status', '--format', 'json'], 20_000)
    if (result.ok) {
      state.auth = result.data
      return state.auth
    }
    // A missing login is a normal state, not an error worth surfacing red.
    state.auth = { authenticated: false, error: result.error }
    return state.auth
  }

  const refreshQuota = async () => {
    const [subscription, usage, balance] = await Promise.all([
      call(['subscription', 'status', '--format', 'json'], 30_000),
      call(['usage', 'summary', '--format', 'json'], 30_000),
      call(['billing', 'balance', 'summary', '--format', 'json'], 20_000),
    ])
    state.subscription = subscription.ok ? subscription.data : { error: subscription.error }
    state.usage = usage.ok ? usage.data : { error: usage.error }
    state.balance = balance.ok ? balance.data : { error: balance.error }
  }

  /* ------------------------------------------------------------------ */
  /* Catalog                                                            */
  /* ------------------------------------------------------------------ */

  const refreshCatalog = async () => {
    const result = await call(['models', 'list', '--all', '--format', 'json', '--verbose'], 120_000)
    if (!result.ok) throw new Error(result.error?.message ?? 'models list failed')
    const rows = buildCatalog(result.data)
    const payload = {
      raw: rows,
      refreshedAt: new Date().toISOString(),
      total: Array.isArray(result.data?.models) ? result.data.models.length : rows.length,
    }
    catalog = payload
    state.raw = rows
    state.refreshedAt = payload.refreshedAt
    /* Re-derive the Credits column from the raw rows: multiplying decorated
       rows again would nest one multiplier inside another. */
    const decorated = withMultipliers(rows, '')
    state.models = decorated.models
    state.baseline = decorated.baseline
    writeJsonFile(catalogPath, { ...payload, models: decorated.models, baseline: decorated.baseline })
    // The picker reads the routes, not this cache, so a new catalog has to reach
    // them or it would keep offering yesterday's models until a restart.
    rebuildRoutes()
    return { ...payload, ...decorated }
  }

  /** Whole minutes since the catalog was last fetched from the CLI. */
  const catalogAgeMinutes = () => {
    const at = state.refreshedAt === undefined ? Number.NaN : Date.parse(state.refreshedAt)
    if (!Number.isFinite(at)) return undefined
    return Math.max(0, Math.round((Date.now() - at) / 60_000))
  }

  /** Whether the catalog is old enough that the background loop should rebuild it. */
  const catalogStale = () => {
    const age = catalogAgeMinutes()
    if (age === undefined) return true
    return age >= settings().catalogRefreshMinutes
  }

  /** Serialize refreshes: the page polls status, the login flow also refreshes. */
  let inFlight
  const refreshAll = (options = {}) => {
    if (inFlight !== undefined) return inFlight
    state.refreshing = true
    state.error = undefined
    inFlight = (async () => {
      try {
        const auth = await refreshAuth()
        if (auth?.authenticated === true) {
          await refreshQuota()
          if (options.catalog !== false) {
            try {
              await refreshCatalog()
            } catch (error) {
              state.error = String(error?.message ?? error)
            }
          }
        }
      } finally {
        state.refreshing = false
        inFlight = undefined
      }
      return state
    })()
    return inFlight
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                           */
  /* ------------------------------------------------------------------ */

  /** Re-derive what the routes serve after a settings change. */
  /**
   * Re-derive what the routes serve after a settings change.
   *
   * Nothing in the settings shapes the catalog rows themselves any more (the
   * pricing baseline left with the multiplier column), so a settings write can
   * never invalidate `state.models` or the persisted catalog. Only the route
   * projection depends on settings — each channel re-filters its own deny-list
   * and re-reads the thinking flags inside `profilesFor`. That keeps a single
   * checkbox click from rewriting a 400 KB catalog file.
   */
  const applySettings = () => {
    rebuildRoutes()
  }

  /**
   * Persist a settings patch.
   *
   * The values live in the profile's configuration document, not in a file this
   * plugin owns, so the host's own configuration page shows the same numbers and
   * a change made there reaches this plugin without a restart.
   */
  const saveSettings = async (patch) => {
    const service = settingsService(ctx)
    if (service === undefined) throw new Error('the settings service is not available in this profile')
    await service.update(settingsNamespace, patch)
  }

  /* ------------------------------------------------------------------ */
  /* Login (two-stage device flow driven through the CLI)               */
  /* ------------------------------------------------------------------ */

  const startLogin = async () => {
    const result = await call(['auth', 'login', '--init-only', '--format', 'json'], 30_000)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    const event = Array.isArray(result.data?.events) ? result.data.events[0] : undefined
    // A live session makes the CLI answer `already_authenticated` instead of a
    // link. That is not a failure: the page shows the remaining validity and
    // keeps the existing session rather than starting a device flow nobody can
    // finish.
    if (event?.event === 'already_authenticated') {
      state.login = undefined
      await refreshAuth()
      return {
        ok: true,
        alreadyAuthenticated: true,
        remaining: typeof event?.token?.remaining === 'string' ? event.token.remaining : undefined,
        auth: state.auth,
      }
    }
    const url = event?.verification_url
    const expiresIn = typeof event?.expires_in === 'number' ? event.expires_in : 300
    if (typeof url !== 'string' || url === '') {
      return { ok: false, error: { code: 'NO_URL', message: 'the CLI returned no verification link' } }
    }
    state.login = {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      startedAt: new Date().toISOString(),
      status: 'waiting',
      message: undefined,
    }
    return { ok: true, login: state.login }
  }

  /**
   * Drive the second stage in the background.
   *
   * The CLI blocks for the whole authorisation window, which is longer than any
   * HTTP request should stay open, so the page is answered immediately and
   * follows the outcome by polling `/status`.
   */
  const completeLogin = async () => {
    if (state.login === undefined) {
      return { ok: false, error: { code: 'NO_LOGIN', message: 'start the login first' } }
    }
    if (state.login.status === 'waiting') {
      // Derive the remaining window rather than the original one: the user may
      // have taken a minute to reach the page.
      const remaining = Math.max(
        10,
        Math.round((Date.parse(state.login.expiresAt) - Date.now()) / 1000) + 20,
      )
      state.login.status = 'polling'
      void (async () => {
        const result = await call(
          ['auth', 'login', '--complete', '--timeout', String(remaining), '--format', 'json'],
          (remaining + 30) * 1000,
        )
        const event = Array.isArray(result.data?.events) ? result.data.events[0] : undefined
        if (result.ok && event?.event === 'success') {
          state.login.status = 'success'
          state.login.message = undefined
          await refreshAll()
          return
        }
        state.login.status = 'failed'
        state.login.message = result.error?.message ?? event?.message ?? 'authorisation did not complete'
      })()
    }
    return { ok: true, login: state.login }
  }

  const logout = async () => {
    const result = await call(['auth', 'logout', '--format', 'json'], 20_000)
    state.auth = undefined
    state.subscription = undefined
    state.usage = undefined
    state.balance = undefined
    state.login = undefined
    await refreshAuth()
    return { ok: result.ok, error: result.ok ? undefined : result.error }
  }

  /* ------------------------------------------------------------------ */
  /* Status payload                                                     */
  /* ------------------------------------------------------------------ */

  const statusPayload = async () => {
    const resolved = cli()
    const current = settings()
    const allRows = Array.isArray(state.models) ? state.models : []
    const enabledCountFor = (provider) => enabledRows(allRows, current.disabledModels?.[provider]).length
    // 目录卡上的「启用数」按通道分开——两条通道的停用清单是两份独立的黑名单。
    const enabledCounts = Object.fromEntries(PROVIDERS.map((provider) => [provider, enabledCountFor(provider)]))
    // 「size」取至少一条通道在用的模型数：两条都停的才算真正不出现在选择器里。
    const bothDenied = new Set(
      (current.disabledModels?.[TOKEN_PLAN] ?? []).filter((id) => (current.disabledModels?.[PAYG] ?? []).includes(id)),
    )
    const modelCount = allRows.filter((row) => bothDenied.has(row.id) !== true).length
    const routes = await Promise.all(
      channels(current).map(async (channel) => ({
        key: channel.provider,
        displayName: channel.displayName,
        baseURL: channel.baseURL,
        apiKeyEnv: channel.apiKeyEnv,
        // Registered by this plugin, so the route cannot go missing from the
        // models page the way a settings-written route could. `false` only while
        // the deferred registration is still in flight or has failed.
        present: state.routesReady === true,
        presentModelCount: enabledCounts[channel.provider] ?? 0,
        adminUrl: channel.provider === TOKEN_PLAN ? 'https://platform.qianwenai.com' : 'https://platform.qianwenai.com',
        credential: await describeKey(ctx, channel.apiKeyEnv).catch((error) => ({
          configured: false,
          reason: String(error?.message ?? error),
        })),
      })),
    )
    return {
      cli: {
        installed: resolved !== undefined,
        entry: resolved?.args?.[0] ?? resolved?.command,
        installDir: cliDir(),
        dataDir: dataDir(),
        install: state.cliInstall,
      },
      // A cold start answers before its first refresh lands; the page uses this
      // to keep polling instead of freezing on an empty shell.
      ready: state.refreshedAt !== undefined,
      refreshedAt: state.refreshedAt,
      settings: current,
      settingsNamespace,
      providers: [...PROVIDERS],
      auth: state.auth,
      subscription: state.subscription,
      usage: state.usage,
      balance: state.balance,
      login: state.login,
      catalog: {
        size: modelCount,
        enabled: enabledCounts,
        total: allRows.length,
        refreshedAt: state.refreshedAt,
        ageMinutes: catalogAgeMinutes(),
        stale: catalogStale(),
        refreshMinutes: current.catalogRefreshMinutes,
        baseline: state.baseline,
        effort: Object.fromEntries(PROVIDERS.map((provider) => [provider, effortFor(provider)])),
      },
      routes,
      /** Non-empty when the host refused the routes (a duplicate adapter left behind). */
      routesError: state.routesError,
      refreshing: state.refreshing,
      error: state.error,
    }
  }

  /* ------------------------------------------------------------------ */
  /* Routes                                                             */
  /* ------------------------------------------------------------------ */

  const routes = [
    {
      path: `${ROUTE_BASE}/status`,
      method: 'GET',
      handler: async () => {
        // A cold start answers from whatever the last build persisted, and kicks
        // off one refresh in the background so the page is populated next poll.
        if (!Array.isArray(state.models) && !state.refreshing) void refreshAll()
        return { status: 200, body: await statusPayload() }
      },
    },
    {
      path: `${ROUTE_BASE}/models`,
      method: 'GET',
      handler: async () => {
        const models = Array.isArray(state.models) ? state.models : []
        /* The page filters and toggles models, so the derived view ships with
           the rows: recomputing capacities in the client would duplicate the
           only place that knows what a catalog row means. */
        const current = settings()
        const deniedPlan = new Set(current.disabledModels?.[TOKEN_PLAN] ?? [])
        const deniedPayg = new Set(current.disabledModels?.[PAYG] ?? [])
        return {
          status: 200,
          body: {
            models: models.map((row) => ({
              ...row,
              family: familyOf(row.id),
              kinds: kindsOf(row),
              enabled: {
                [TOKEN_PLAN]: deniedPlan.has(row.id) !== true,
                [PAYG]: deniedPayg.has(row.id) !== true,
              },
            })),
            baseline: state.baseline,
            refreshedAt: state.refreshedAt,
            effort: Object.fromEntries(PROVIDERS.map((provider) => [provider, effortFor(provider)])),
            disabled: { [TOKEN_PLAN]: [...deniedPlan], [PAYG]: [...deniedPayg] },
          },
        }
      },
    },
    {
      path: `${ROUTE_BASE}/refresh`,
      method: 'POST',
      handler: async () => {
        await refreshAll()
        return { status: 200, body: await statusPayload() }
      },
    },
    {
      path: `${ROUTE_BASE}/settings`,
      method: 'POST',
      handler: async (req, res, body) => {
        const patch = {}
        for (const key of Object.keys(Config.dict ?? {})) {
          if (body[key] !== undefined) patch[key] = body[key]
        }
        try {
          await saveSettings(patch)
        } catch (error) {
          return { status: 400, body: { ok: false, error: String(error?.message ?? error) } }
        }
        /* The host commits the new values asynchronously, and the answer here is
           what the page rebinds its form to: returning the old document would
           make a successful save look like a rejected one. Wait for the live
           config to catch up (bounded), then re-derive the routes ourselves in
           case the document event lands after this request. The two deny-lists
           live under `disabledModels[provider]` inside settings(), not at the
           patch key's own name — comparing against `settings()[key]` directly
           would never match and every write would burn the full 1.5 s timeout. */
        const wanted = Object.entries(patch)
        const readBack = (key) =>
          key === 'tokenPlanDisabledModels'
            ? settings().disabledModels[TOKEN_PLAN]
            : key === 'paygDisabledModels'
              ? settings().disabledModels[PAYG]
              : settings()[key]
        const sameValue = (left, right) => {
          if (Array.isArray(left) || Array.isArray(right)) {
            return (
              Array.isArray(left) &&
              Array.isArray(right) &&
              left.length === right.length &&
              left.every((item, index) => item === right[index])
            )
          }
          return `${left}` === `${right}`
        }
        const matches = () => wanted.every(([key, value]) => sameValue(readBack(key), value))
        for (let attempt = 0; attempt < 30 && wanted.length > 0; attempt++) {
          if (matches()) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        applySettings()
        // A checkbox click used to drag the whole status payload (credential
        // lookups, route table) back over the wire for nobody to read. The page
        // only rebinds form values here; everything else it re-fetches itself.
        return { status: 200, body: { ok: true, settings: settings() } }
      },
    },
    {
      path: `${ROUTE_BASE}/sync`,
      method: 'POST',
      handler: async () => {
        // Nothing to write anywhere any more: the routes ARE this plugin's, and
        // a rebuild is all a "sync" can mean. Kept as a route because the page's
        // 同步 button still posts to it.
        rebuildRoutes()
        const current = settings()
        const allRows = Array.isArray(state.models) ? state.models : []
        return {
          status: 200,
          body: {
            ok: true,
            routes: [...PROVIDERS],
            models: Object.fromEntries(
              PROVIDERS.map((provider) => [provider, enabledRows(allRows, current.disabledModels?.[provider]).length]),
            ),
          },
        }
      },
    },
    {
      path: `${ROUTE_BASE}/cli/install`,
      method: 'POST',
      handler: async () => {
        const result = await installCli()
        return {
          status: result.status === 'failed' ? 502 : 200,
          body: {
            ok: result.status !== 'failed',
            install: result,
            cli: { installed: cli() !== undefined },
          },
        }
      },
    },
    {
      path: `${ROUTE_BASE}/keys`,
      method: 'POST',
      handler: async (req, res, body) => {
        // Writing a key reaches the next model call without a restart: the
        // adapter resolves the reference through `ctx.credentials` per request.
        const target = body.target === 'payg' ? 'payg' : body.target === 'tokenPlan' ? 'tokenPlan' : undefined
        if (target === undefined) return { status: 400, body: { ok: false, error: 'target must be tokenPlan or payg' } }
        const current = settings()
        const name = target === 'payg' ? current.paygApiKeyEnv : current.tokenPlanApiKeyEnv
        try {
          await writeKey(ctx, name, body.apiKey)
        } catch (error) {
          return { status: 400, body: { ok: false, error: String(error?.message ?? error) } }
        }
        return { status: 200, body: { ok: true, key: { name, ...(await describeKey(ctx, name)) } } }
      },
    },
    {
      path: `${ROUTE_BASE}/keys/clear`,
      method: 'POST',
      handler: async (req, res, body) => {
        const target = body.target === 'payg' ? 'payg' : body.target === 'tokenPlan' ? 'tokenPlan' : undefined
        if (target === undefined) return { status: 400, body: { ok: false, error: 'target must be tokenPlan or payg' } }
        const current = settings()
        const name = target === 'payg' ? current.paygApiKeyEnv : current.tokenPlanApiKeyEnv
        try {
          await clearKey(ctx, name)
        } catch (error) {
          return { status: 400, body: { ok: false, error: String(error?.message ?? error) } }
        }
        return { status: 200, body: { ok: true, key: { name, ...(await describeKey(ctx, name)) } } }
      },
    },
    {
      path: `${ROUTE_BASE}/login/init`,
      method: 'POST',
      handler: async () => {
        const result = await startLogin()
        return { status: result.ok ? 200 : 502, body: result }
      },
    },
    {
      path: `${ROUTE_BASE}/login/complete`,
      method: 'POST',
      handler: async () => {
        const result = await completeLogin()
        return { status: result.ok ? 202 : 409, body: result }
      },
    },
    {
      path: `${ROUTE_BASE}/logout`,
      method: 'POST',
      handler: async () => {
        const result = await logout()
        return { status: 200, body: result }
      },
    },
    {
      path: `${ROUTE_BASE}/summary`,
      method: 'GET',
      handler: async () => {
        const individual = state.subscription?.individual
        const credits = individual?.monthlyCredits
        return {
          status: 200,
          body: {
            authenticated: state.auth?.authenticated === true,
            planName: individual?.name ?? individual?.edition,
            usedPct: typeof credits?.usedPct === 'number' ? credits.usedPct : undefined,
            remainingPct: typeof credits?.remainingPct === 'number' ? credits.remainingPct : undefined,
            resetTime: credits?.resetTime,
            remainingDays: individual?.remainingDays,
            balance: state.balance?.availableAmount,
            currency: state.balance?.currency,
            refreshedAt: state.refreshedAt,
          },
        }
      },
    },
  ]

  ctx.effect(() => {
    const disposers = []
    for (const route of routes) {
      const disposer = ctx.webServer.register({
        kind: 'exact',
        path: route.path,
        handler: async (req, res) => {
          if (req.method !== route.method) {
            json(res, 405, { error: `use ${route.method}` })
            return
          }
          const connection = connectionOf(ctx)
          if (connection) {
            const rejection = connection.requestRejection(req)
            if (rejection !== undefined) {
              json(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
              return
            }
          } else if (!requireLoopback(req, res)) return
          try {
            const body = route.method === 'POST' ? await readBody(req) : {}
            const result = await route.handler(req, res, body)
            if (result !== undefined) json(res, result.status ?? 200, result.body ?? {})
          } catch (error) {
            log(ctx, 'warn', `${route.path} failed: ${String(error?.message ?? error)}`)
            json(res, 500, { error: String(error?.message ?? error) })
          }
        },
      })
      disposers.push(disposer)
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
    }
  }, 'dsh-qianwen: loopback routes')

  /* The routes themselves. Registration is deferred out of the effect body so
     the duplicate-retry can await the host's reconcile without blocking the
     plugin mount; the disposer still releases whatever was registered. */
  ctx.effect(() => {
    let disposed = false
    let release
    void (async () => {
      const handle = await registerRoutes()
      if (disposed) {
        handle.dispose()
        return
      }
      release = handle.dispose
    })()
    return () => {
      disposed = true
      if (release !== undefined) {
        try {
          release()
        } catch {}
      }
    }
  }, 'dsh-qianwen: provider routes')

  // Warm the cache once so the settings page is populated on first open, and
  // keep it warm afterwards. The quota poll is cheap; rebuilding the catalog is
  // not, so it only happens once the persisted copy has aged past
  // `catalogRefreshMinutes`. Both timers die with the plugin.
  ctx.effect(() => {
    void refreshAll()
    const timer = setInterval(() => {
      void refreshAll({ catalog: catalogStale() })
    }, settings().refreshMinutes * 60_000)
    return () => clearInterval(timer)
  }, 'dsh-qianwen: refresh loop')

  /* The host's own configuration page edits the same fields this page does, and
     the model-shaping ones (thinking mode, key references, baseline) have to
     reach the routes without a restart. A short debounce also batches the
     several `set` operations of one form save into one rebuild. */
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return () => {}
    let pending
    const dispose = ctx.on('settings/document-updated', (ns) => {
      if (ns !== settingsNamespace) return
      if (pending !== undefined) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = undefined
        try {
          applySettings()
        } catch (error) {
          log(ctx, 'warn', `could not apply the new settings: ${String(error?.message ?? error)}`)
        }
      }, 250)
    })
    return () => {
      if (typeof dispose === 'function') dispose()
      if (pending !== undefined) clearTimeout(pending)
    }
  }, 'dsh-qianwen: settings changes')

  /* The session log is where an explicit picker choice becomes durable, so it
     is also the only honest place to learn a route default from: a recorded
     `request/header` states the effort that request used, and
     `adapterDefaults.reasoningEffort` says whether the caller chose it or the
     adapter defaulted it. Only a caller choice is worth remembering — adopting
     our own default back would make the level impossible to change. */
  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return () => {}
    let pending
    let learnedEffortChanged = false
    const adopt = () => {
      pending = undefined
      if (learnedEffortChanged !== true) return
      learnedEffortChanged = false
      try {
        writeJsonFile(effortPath, learnedEffort)
      } catch (error) {
        log(ctx, 'warn', `could not persist the learned thinking level: ${String(error?.message ?? error)}`)
      }
      rebuildRoutes()
    }
    const dispose = ctx.on('session/event', (_session, event) => {
      if (event?.type !== 'request/header') return
      if (settings().rememberThinkingEffort !== true) return
      const header = event.data?.header
      const provider = header?.config?.provider
      if (PROVIDERS.includes(provider) !== true) return
      if (header?.adapterDefaults?.reasoningEffort === true) return
      const effort = normalizeEffort(header?.config?.reasoningEffort)
      if (effort === undefined || learnedEffort?.[provider] === effort) return
      learnedEffort = { ...learnedEffort, [provider]: effort }
      learnedEffortChanged = true
      if (pending !== undefined) clearTimeout(pending)
      pending = setTimeout(adopt, 1_000)
    })
    return () => {
      if (typeof dispose === 'function') dispose()
      if (pending !== undefined) clearTimeout(pending)
    }
  }, 'dsh-qianwen: learned thinking level')

  /* Let the host's settings page own this plugin's fields: the section it
     generates is where a profile-level edit belongs, and `configure` is what
     makes them visible there at all. `auto` stays false because this plugin
     ships its own page — two copies of the same form would drift. */
  ctx.inject(['settings'], (sctx) => {
    ctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), 'dsh-qianwen: settings form')
  })
}

export { PAYG, PROVIDERS, TOKEN_PLAN }
