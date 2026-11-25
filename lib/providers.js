/**
 * Projection of the Qianwen catalog onto pi-ai provider profiles.
 *
 * The plugin owns two provider routes outright instead of writing them into the
 * installed pi-ai adapter's configuration. That distinction is the whole point
 * of this module: a route written into 设置 → 模型 is a route the models page can
 * rename, empty, or delete, and the host offers no read-only provider, so the
 * previous design had to watch that page and put the route back. A route
 * registered by this plugin (`registerAdapter` + a section-level
 * `registerConfigurableProviders` entry with an empty `settingsPath`) cannot be
 * deleted at all, and nothing outside this file can change what it serves.
 *
 * What the routes still share with the host's adapter is the wire protocol and
 * the streaming implementation: every Qianwen model speaks OpenAI
 * chat-completions, so each route is a pi-ai provider fed to `PiAiAdapter`.
 */

import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

/** Wire protocol every Qianwen route speaks. */
const API = 'openai-completions'

/** Default output capability when the catalog does not size a model. */
const DEFAULT_MAX_TOKENS = 131_072

/** Default context capability when the catalog does not size a model. */
const DEFAULT_CONTEXT_WINDOW = 1_000_000

/**
 * Harness cost is tracked by its own meter, and the plugin has no per-token
 * price to declare here: the catalog's figures are credits, not USD, and
 * expressing them as money would put a wrong number in front of every request.
 */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** Token Plan channel: a subscription Key, its own endpoint. */
export const TOKEN_PLAN = 'qianwen-token-plan'

/** Pay-as-you-go channel: a per-token Key, the public endpoint. */
export const PAYG = 'qianwen'

/** Both routes, in the order the page lists them. */
export const PROVIDERS = [TOKEN_PLAN, PAYG]

/**
 * How long one stream may stay silent before the adapter aborts it.
 *
 * The same five minutes the host's own pi-ai routes use: a thinking model can
 * take a while before its first token, but a route that has said nothing for
 * five minutes is not going to.
 */
const STREAM_IDLE_TIMEOUT_MS = 300_000

/**
 * Image budgets for the request projection.
 *
 * The values are the host pi-ai defaults (`dsh-llm-pi-ai/src/config.ts`). They
 * are restated rather than imported because they are part of the resolved
 * profile this plugin hands the adapter — an import would tie the plugin to a
 * private module path for four numbers that only move with a DSH release.
 */
const REQUEST_IMAGE_BUDGETS = {
  maxRequestImages: 50,
  imageOffloadCountQuantum: 10,
  maxRequestImageBytes: 20 * 1024 * 1024,
  requestImagePixelBudget: 2048 * 2048,
  requestImageMaxBytes: 1024 * 1024,
}

/**
 * Families whose endpoint documents effort levels next to the thinking switch.
 *
 * `qwen4-max` is the documented case ("默认 reasoning_effort=high"), and it is
 * also the only family whose `thinking_budget` field the platform writes down,
 * so the budget-carrying field is attached here and nowhere else. Everything
 * else on the platform exposes thinking as a switch, so it offers off/high and
 * sends no effort string at all.
 */
function effortProfile(id) {
  if (/^qwen4/.test(id)) {
    return {
      levels: { off: null, low: 'low', medium: 'medium', high: 'high' },
      supportsReasoningEffort: true,
      budgetField: 'thinking_budget',
    }
  }
  return { levels: { off: null, high: 'high' } }
}

/**
 * Family a catalog id belongs to, for the page's quick filters.
 *
 * Third-party ids arrive as `ZHIPU/GLM-5.3`; everything else is a hyphenated
 * Qwen name whose first two segments are the family (`qwen3.8-max` →
 * `qwen3.8`, `qwen-audio-3.1-realtime-flash` → `qwen-audio`).
 */
export function familyOf(id) {
  const text = String(id ?? '')
  /* A vendor prefix (`vanchin/deepseek-v4`) groups by the vendor: that is what
     tells apart a first-party model from the same model resold elsewhere. */
  const slash = text.indexOf('/')
  if (slash > 0) return text.slice(0, slash)
  /* Everything else groups by brand plus whatever version is glued to it:
     `qwen3.8-max` → `qwen3.8`, `qwen4-plus` → `qwen4`, `glm-5.3` → `glm`. The
     result is deliberately coarse — a family is a shelf, not a spec. */
  const match = text.match(/^[a-zA-Z]+[0-9.]*/)
  return match === null ? 'other' : match[0]
}

/**
 * Capability buckets one catalog row falls into.
 *
 * These are what the page filters on. They are derived from the catalog instead
 * of being a second list of model names to keep in sync: the only durable claim
 * here is about modalities and the reasoning flag, both of which the platform
 * itself publishes.
 */
export function kindsOf(row) {
  const input = Array.isArray(row?.input) ? row.input : []
  const output = Array.isArray(row?.output) ? row.output : []
  const kinds = ['text']
  if (row?.vision === true || input.includes('image') || input.includes('video')) kinds.push('multimodal')
  if (input.includes('audio') || output.includes('audio')) kinds.push('audio')
  if (row?.reasoning === true) kinds.push('reasoning')
  if (String(row?.id ?? '').includes('/')) kinds.push('thirdParty')
  return kinds
}

/**
 * The rows the routes actually serve.
 *
 * `disabledModels` is a deny-list rather than an allow-list on purpose: an empty
 * deny-list means "everything", so a new platform model shows up without anyone
 * touching the setting, and the list keeps meaning when the catalog grows.
 */
export function enabledRows(rows, disabled) {
  const list = Array.isArray(disabled) ? disabled : []
  if (list.length === 0) return Array.isArray(rows) ? rows : []
  const denied = new Set(list)
  return (Array.isArray(rows) ? rows : []).filter((row) => denied.has(row.id) !== true)
}

/** One channel definition: endpoint, label, credential reference. */
function channelOf(settings, provider) {
  const tokenPlan = provider === TOKEN_PLAN
  return {
    provider,
    displayName: tokenPlan ? '千问 Token Plan' : '千问 按量付费',
    baseURL: tokenPlan
      ? 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1'
      : 'https://maas.qianwenaiapi.com/compatible-mode/v1',
    apiKeyEnv: tokenPlan ? settings.tokenPlanApiKeyEnv : settings.paygApiKeyEnv,
    disableThinking: settings.thinkingMode === 'off',
  }
}

/** Both channels for the current settings. */
export function channels(settings) {
  return PROVIDERS.map((provider) => channelOf(settings, provider))
}

/** The channel for one route, or `undefined` when the route is not ours. */
export function channelFor(settings, provider) {
  return PROVIDERS.includes(provider) ? channelOf(settings, provider) : undefined
}

/**
 * Build one pi-ai model entry.
 *
 * `thinkingLevelMap` is deliberately explicit rather than inherited: a model
 * declared here has no installed catalog behind it, so without the map the
 * picker would offer no thinking control at all — which is exactly the gap this
 * plugin exists to close. Undeclared levels are pinned to `null` so the adapter
 * sends nothing for them instead of inventing an effort string.
 */
export function toPiModel(row, channel) {
  const model = {
    id: row.id,
    name: row.id,
    api: API,
    provider: channel.provider,
    baseUrl: channel.baseURL,
    input: row.vision ? ['text', 'image'] : ['text'],
    cost: NO_COST,
    contextWindow: row.contextWindow > 0 ? row.contextWindow : DEFAULT_CONTEXT_WINDOW,
    maxTokens: row.maxOutput > 0 ? row.maxOutput : DEFAULT_MAX_TOKENS,
    reasoning: false,
  }
  if (!row.reasoning || channel.disableThinking) return model
  const profile = effortProfile(row.id)
  const levels = profile.levels
  model.reasoning = true
  model.thinkingLevelMap = {
    off: levels.off,
    low: levels.low,
    medium: levels.medium,
    high: levels.high,
  }
  model.compat = {
    thinkingFormat: 'qwen',
    supportsReasoningEffort: profile.supportsReasoningEffort === true,
    ...(profile.budgetField === undefined ? {} : { thinkingTokenBudgetField: profile.budgetField }),
  }
  return model
}

/**
 * Build one pi-ai provider for a channel.
 *
 * `resolveKey` is consulted per call rather than captured: the credential lives
 * in the credential service and the reference name is a live setting, so a key
 * pasted into the page reaches the next request without a reload.
 */
export function toPiProvider(channel, rows, resolveKey) {
  const models = rows.map((row) => toPiModel(row, channel))
  return createProvider({
    id: channel.provider,
    name: channel.displayName,
    baseUrl: channel.baseURL,
    auth: {
      apiKey: {
        name: channel.displayName,
        async resolve() {
          const apiKey = await resolveKey(channel)
          return apiKey === undefined ? undefined : { auth: { apiKey }, source: 'dsh-qianwen' }
        },
      },
    },
    models,
    api: openAICompletionsApi(),
  })
}

/**
 * `PiAiAdapter` that never hands a thinking level to a model that cannot take it.
 *
 * A route's default level lives on the profile, which covers every model on that
 * route — but a route carries thinking and non-thinking models side by side. The
 * host adapter validates the level with `resolveReasoningLevel` and throws
 * `UNSUPPORTED_REASONING_EFFORT` instead of clamping, so without this guard one
 * route-wide default would break every request that lands on a plain model (or on
 * a model whose `off` level is unmapped, like qwen4).
 *
 * The guard asks the resolved model which levels it offers and, when the wanted
 * one is missing, substitutes the closest thing that model honours: `off` when it
 * has one, otherwise its first level (the lowest). `prepareCall` does not look at
 * the level, so overriding `stream` covers every path into the adapter.
 */
export class QianwenAdapter extends PiAiAdapter {
  constructor(options, effortOf) {
    super(options)
    this.effortOf = effortOf
  }

  async *stream(options) {
    const wanted =
      options.reasoningEffort ?? (this.effortOf === undefined ? undefined : this.effortOf(options.provider))
    if (wanted === undefined || wanted === 'off') {
      yield* super.stream(options)
      return
    }
    let offered
    try {
      const info = await this.resolveModel(options.provider, options.model, options.signal)
      offered = (info.reasoning?.efforts ?? []).map((item) => item.id)
    } catch {
      offered = undefined
    }
    if (offered === undefined || offered.includes(wanted)) {
      yield* super.stream(options)
      return
    }
    const fallback = offered.includes('off') ? 'off' : (offered[0] ?? 'off')
    yield* super.stream({ ...options, reasoningEffort: fallback })
  }
}

/**
 * Build the profile map `PiAiAdapter` resolves routes and models through.
 *
 * A brand-new Map is returned on every rebuild because that identity is what
 * makes the adapter rebuild its model collection: mutating the previous map in
 * place would leave the adapter serving the old models.
 *
 * `effortOf` answers the route's default thinking level. It lands on the
 * profile, not the model, because that is the only place pi-ai exposes a default
 * (`describableReasoningLevel` then drops it for models that do not offer that
 * level, so one route-wide value stays honest for a mixed catalog).
 *
 * `rows` is the full catalog: each channel filters it through its own deny-list
 * (`settings.disabledModels[channel.provider]`), because "which models do I keep
 * switched on" can differ between the subscription and the pay-as-you-go route.
 */
export function profilesFor(rows, settings, { resolveKey, retryPolicy, effortOf }) {
  const profiles = new Map()
  for (const channel of channels(settings)) {
    const effort = effortOf === undefined ? undefined : effortOf(channel.provider)
    const channelRows = enabledRows(rows, settings?.disabledModels?.[channel.provider])
    profiles.set(channel.provider, {
      provider: channel.provider,
      displayName: channel.displayName,
      streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      retryPolicy,
      ...(effort === undefined ? {} : { reasoning: effort }),
      ...REQUEST_IMAGE_BUDGETS,
      modelErrors: new Map(),
      configuredMaxTokens: new Map(),
      piProvider: toPiProvider(channel, channelRows, resolveKey),
    })
  }
  return profiles
}

/**
 * The directory entries the models page needs to show these two routes.
 *
 * `settingsPath: []` is the load-bearing field: the models page only renders a
 * delete control for a provider whose settings live under a non-empty path, so
 * an empty path means "this route is configured by its plugin, not here". The
 * namespace still has to resolve, otherwise the page reports the route as
 * unconfigured.
 */
export function directoryEntries(settingsNs, settings) {
  return channels(settings).map((channel) => ({
    provider: channel.provider,
    displayName: channel.displayName,
    settingsNs,
    settingsPath: [],
    declared: false,
  }))
}
