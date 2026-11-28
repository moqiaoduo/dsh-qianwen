/**
 * Browser half of the Qianwen integration.
 *
 * One settings page owns the whole surface: sign-in (driven through the host's
 * CLI bridge), remaining Token Plan credits, the catalog priced per mode
 * (Credits/1M on the plan side, ¥/1M on pay-as-you-go), and the two provider
 * routes this plugin registers directly with the LLM service.
 * Nothing here talks to qianwenai.com directly — the host route table is the
 * only peer, which keeps the CLI, its credentials and the cache in one place.
 */
window.__ModuleLoader__.load({
  id: 'dsh-qianwen',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Loopback route table served by this plugin's host half. */
    const BASE = '/plugins/dsh-qianwen'

    const NAMESPACE = 'dsh-qianwen.settings'

    // 后端还没答上来时也要能填 Key：这两条路由的端点是固定的，先按它渲染，
    // /status 一到就用真实配置覆盖（真实值只多不少）。
    /** 按量付费路由的 key，用来把界面上的「按量付费」通道对上它的 Key。 */
    const PAYG_ROUTE = 'qianwen'
    /** Token Plan 路由的 key。 */
    const TOKEN_PLAN_ROUTE = 'qianwen-token-plan'
    /**
     * 两个模式的 tab 定义。`field` 是服务端各自的停用黑名单——套餐与按量
     * 各自一份启用清单，切换 tab 就是切换写入目标。
     */
    const MODES = [
      { target: 'tokenPlan', route: TOKEN_PLAN_ROUTE, field: 'tokenPlanDisabledModels', labelKey: 'routes.tokenPlan' },
      { target: 'payg', route: PAYG_ROUTE, field: 'paygDisabledModels', labelKey: 'routes.payg' },
    ]

    const FALLBACK_ROUTES = [
      {
        key: 'qianwen-token-plan',
        displayNameKey: 'routes.tokenPlan',
        apiKeyEnv: 'QIANWEN_TOKEN_PLAN_API_KEY',
        baseURL: 'https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1',
      },
      {
        key: PAYG_ROUTE,
        displayNameKey: 'routes.payg',
        apiKeyEnv: 'QIANWEN_PAYG_API_KEY',
        baseURL: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
      },
    ]

    const CJK = {
      'nav.label': '千问',
      'page.title': '千问 AI 平台',
      'page.desc':
        '把 platform.qianwenai.com 的 Token Plan 与按量付费用量接进 DeepSeek Harness：按通道分开的模型目录（套餐看 Credits/1M、按量看 ¥ 单价）、剩余额度、思考模式开关与档位。',
      'common.refresh': '刷新',
      'common.refreshing': '刷新中…',
      'common.retry': '重试',
      'common.close': '关闭',
      'common.none': '未获取',
      'common.loading': '正在读取千问平台数据（首次可能需要几秒）…',
      'common.checking': '检查中…',
      'common.reading': '读取中…',
      'common.timeout': '读取超时 · 点「刷新」重试',
      'common.failed': '读取失败',
      'cli.label': '官方 CLI',
      'cli.missing': '未安装',
      'cli.missingHint': '需要官方 qianwen CLI：npm i -g @qianwenai/qianwen-cli',
      'cli.installed': '已就绪',
      'auth.label': '账号',
      'auth.signedIn': '已登录',
      'auth.signedOut': '未登录',
      'auth.signIn': '登录千问账号',
      'auth.signOut': '退出登录',
      'auth.waiting': '等待授权…',
      'auth.completing': '正在确认授权…',
      'auth.openLink': '打开授权页面',
      'auth.confirmed': '我已授权，继续',
      'auth.expiresIn': '链接 {n} 秒后失效',
      'auth.expired': '授权链接已过期，请重新发起登录',
      'auth.failed': '授权未完成',
      'auth.hint': '浏览器里完成授权即可，无需在终端输入命令。',
      'auth.expiresLabel': '登录有效期',
      'auth.expiresLeft': '还剩 {d}',
      'auth.expiresSoon': '快过期了，重新登录即可续期（服务端固定 48 小时）',
      'auth.expiresExpired': '登录已过期，额度与目录暂停刷新；模型调用不受影响。',
      'auth.renew': '重新登录',
      'auth.stillValid': '当前登录仍然有效，还剩 {d}，无需重新授权。',
      'auth.windowLeft': '链接还剩 {n} 秒',
      'auth.windowOver': '链接窗口已关闭，重新点「登录千问账号」获取新链接。',
      'plan.title': '套餐与额度',
      'plan.name': '套餐',
      'quota.short': '千问额度',
      'quota.label': '额度',
      'quota.panelTitle': '千问额度',
      'quota.loading': '读取中…',
      'quota.unknown': '未登录',
      'quota.failed': '读取失败',
      'quota.expired': '登录已过期',
      'quota.renew': '去续期',
      'quota.renewOpening': '正在获取授权链接…',
      'quota.renewOpened': '授权页已打开；完成后点「完成登录」。',
      'quota.openAuth': '重新打开授权页',
      'quota.completeLogin': '完成登录',
      'quota.renewFailed': '无法发起登录',
      'quota.expiredNote': '登录已过期：这里看不到额度与目录，模型调用不受影响。',
      'quota.updatedAt': '更新于 {time}',
      'quota.settingsHint': '完整视图在「设置 → 千问」。',
      'plan.status': '状态',
      'plan.period': '有效期',
      'plan.remainingDays': '剩余 {n} 天',
      'plan.used': '已用 {n}%',
      'plan.remaining': '剩余额度',
      'plan.reset': '额度重置',
      'plan.usedLabel': '已用',
      'plan.daysLeft': '剩余天数',
      'plan.credits': 'Credits',
      'plan.creditPacks': '加油包',
      'plan.balance': '账户余额',
      'plan.autoRenew': '自动续费',
      'plan.autoRenewOn': '开启中',
      'plan.autoRenewOff': '已关闭',
      'plan.balanceHint': '余额 {v} 见「按量付费」页',
      'plan.balancePayg': '按量付费余额',
      'plan.balanceNote': '不含套餐 Credits。',
      'plan.noSubscription': '当前未订阅 Token Plan，按量付费按目录价计费。',
      'models.title': '模型目录',
      'models.count': '共 {n} 个文本模型',
      'models.search': '搜索模型 id 或能力',
      'models.model': '模型',
      'models.priceIn': '输入 ¥/1M',
      'models.priceOut': '输出 ¥/1M',
      'models.priceBoth': '单价 ¥/1M 输入 / 输出',
      'models.creditsBoth': 'Credits/1M 输入 / 输出',
      'models.credits': 'Credits/1M',
      'models.context': '上下文',
      'models.vision': '视觉',
      'models.tiers': '{n} 档阶梯价',
      'models.onOff': '可切换',
      'models.thinking': '思考',
      'models.creditsNote': '每 1M tokens 的 Credits 消耗（目录单价 ×100 推算，1 Credit = 0.01 元，非平台字段）。',
      'models.priceNote': '平台目录单价：¥/1M 输入 / 输出。',
      'models.empty': '还没有目录数据，先点「刷新」。',
      'models.truncated': '已显示前 {n} 个，用搜索缩小范围。',
      'routes.title': 'Provider 对接',
      'routes.pickerNote': '未填 Key 的通道在选择器里不出现。',
      'routes.keyEnv': 'Key 环境变量',
      'routes.tokenPlan': 'Token Plan',
      'routes.payg': '按量付费',
      'routes.models': '{n} 个模型',
      'routes.live': '已注册 · {n} 个模型',
      'routes.needModels': '先点右上角「刷新」读到模型目录，路由才有模型可选。',
      'routes.notInConfig': '路由未注册',
      'routes.broken': '路由未能注册：{msg}',
      'keys.configured': 'Key 已配置',
      'keys.missing': '未配置 Key',
      'keys.placeholder': '粘贴 {name} 的 Key',
      'keys.save': '保存 Key',
      'keys.saving': '保存中…',
      'keys.clear': '清除',
      'keys.saved': 'Key 已写入凭证文件，下次调用即生效',
      'keys.cleared': 'Key 已清除',
      'settings.title': '选项',
      'settings.thinking': '思考模式',
      'settings.thinkingAuto': '按模型能力开放档位',
      'settings.thinkingOff': '全部关闭（不声明思考参数）',
      'settings.refresh': '自动刷新间隔（分钟）',
      'settings.apiKeyEnv': 'Token Plan 的 Key 环境变量名',
      'settings.apiKeyEnvPayg': '按量付费的 Key 环境变量名',
      'settings.save': '保存',
      'settings.saved': '已保存',
      'settings.catalogRefresh': '目录重建周期（分钟）',
      'settings.cliPath': 'CLI 路径',
      'settings.cliPathHint': '留空自动查找：插件数据目录 → 全局安装',
      'settings.defaultEffort': '默认思考强度',
      'settings.effortLearned': '沿用各通道上次的选择',
      'settings.effortOff': '关闭思考',
      'settings.effortLow': '低',
      'settings.effortMedium': '中',
      'settings.effortHigh': '高',
      'settings.rememberEffort': '记住选择器里的强度',
      'settings.rememberEffortNote': '把选择器里换的档位记为该通道默认',
      'models.countEnabled': '启用 {on} / 共 {n} 个',
      'models.enabled': '启用',
      'models.enabledNote': '停用的不出现在模型选择器里',
      'models.onlyThese': '只留筛出的 {n} 个',
      'models.onlyTheseHint': '把筛选结果之外的模型全部停用',
      'models.enableAll': '全部启用',
      'models.disableAll': '全不选',
      'models.pendingSave': '有改动未保存…',
      'models.saving': '保存中…',
      'models.disableAllHint': '停用此模式全部模型；全停用后选择器里这条通道没有模型。',
      'payg.monthCost': '本月按量花费',
      'payg.freeTier': '免费额度',
      'payg.freeTierCount': '{n} 个模型有',
      'payg.freeTierNote': '与套餐 Credits 无关的免费额度',
      'payg.freeLeft': '剩余 / 总量',
      'payg.freeReset': '到期',
      'payg.orderNote': '扣费顺序：套餐 → 加油包 → 余额；用尽即阻断，不转按量。',
      'models.kind.textOnly': '纯文本',
      'models.noMatch': '没有同时满足这些标签的模型。',
      'models.clearFilters': '清空筛选',
      'models.kind.multimodal': '多模态',
      'models.kind.audio': '音频',
      'models.kind.reasoning': '思考',
      'models.kind.thirdParty': '第三方',
      'models.catalogAt': '目录更新于 {time}',
      'models.catalogAge': '目录更新于 {time} · {n} 分钟前',
      'models.catalogStale': '目录超过 {n} 分钟没重建，后台正在更新',
      'models.rebuild': '重建目录',
      'models.rebuilding': '重建中…',
      'models.cardOwned': '由 dsh-qianwen 提供：模型来自千问目录，这里只能填 Key。',
      'error.prefix': '错误：',
    }

    const EN = {
      'nav.label': 'Qianwen',
      'page.title': 'Qianwen AI platform',
      'page.desc':
        'Brings the Token Plan and pay-as-you-go usage of platform.qianwenai.com into DeepSeek Harness: per-route model catalog (Credits/1M on the plan side, ¥ prices on pay-as-you-go), remaining credits, thinking switch and levels.',
      'common.refresh': 'Refresh',
      'common.refreshing': 'Refreshing…',
      'common.retry': 'Retry',
      'common.close': 'Close',
      'common.none': 'Not available',
      'common.loading': 'Loading Qianwen platform data…',
      'common.checking': 'Checking…',
      'common.reading': 'Reading…',
      'common.timeout': 'Timed out · press Refresh to retry',
      'common.failed': 'Read failed',
      'cli.label': 'Official CLI',
      'cli.missing': 'Not installed',
      'cli.missingHint': 'Needs the official qianwen CLI: npm i -g @qianwenai/qianwen-cli',
      'cli.installed': 'Ready',
      'auth.label': 'Account',
      'auth.signedIn': 'Signed in',
      'auth.signedOut': 'Not signed in',
      'auth.signIn': 'Sign in to Qianwen',
      'auth.signOut': 'Sign out',
      'auth.waiting': 'Waiting for authorisation…',
      'auth.completing': 'Confirming…',
      'auth.openLink': 'Open authorisation page',
      'auth.confirmed': 'I authorised it',
      'auth.expiresIn': 'Link expires in {n}s',
      'auth.expired': 'The link expired — start again',
      'auth.failed': 'Authorisation did not complete',
      'auth.hint': 'Authorise in the browser; no terminal command needed.',
      'auth.expiresLabel': 'Session valid until',
      'auth.expiresLeft': '{d} left',
      'auth.expiresSoon': 'Expiring soon. Sign in again to renew (the server fixes the 48-hour lifetime).',
      'auth.expiresExpired': 'Sign-in expired: quotas and catalog paused. Model calls keep working.',
      'auth.renew': 'Sign in again',
      'auth.stillValid': 'The existing session is still valid ({d} left); no new authorisation needed.',
      'auth.windowLeft': '{n}s left on this link',
      'auth.windowOver': 'The link window closed — press "Sign in to Qianwen" for a new one.',
      'plan.title': 'Plan and credits',
      'plan.name': 'Plan',
      'quota.short': 'Qianwen quota',
      'quota.label': 'Quota',
      'quota.panelTitle': 'Qianwen quota',
      'quota.loading': 'Reading…',
      'quota.unknown': 'Not signed in',
      'quota.failed': 'Read failed',
      'quota.expired': 'Sign-in expired',
      'quota.renew': 'Renew',
      'quota.renewOpening': 'Requesting the authorization link…',
      'quota.renewOpened': 'Authorization page opened; click "Finish sign-in" when done.',
      'quota.openAuth': 'Reopen authorization page',
      'quota.completeLogin': 'Finish sign-in',
      'quota.renewFailed': 'Could not start sign-in',
      'quota.expiredNote': 'Sign-in expired: quotas and catalog are stale. Model calls keep working.',
      'quota.updatedAt': 'Updated {time}',
      'quota.settingsHint': 'Full view under Settings → Qianwen.',
      'plan.status': 'Status',
      'plan.period': 'Period',
      'plan.remainingDays': '{n} days left',
      'plan.used': 'Used {n}%',
      'plan.remaining': 'Remaining',
      'plan.reset': 'Resets',
      'plan.usedLabel': 'Used',
      'plan.daysLeft': 'Days left',
      'plan.credits': 'Credits',
      'plan.creditPacks': 'Credit packs',
      'plan.balance': 'Balance',
      'plan.autoRenew': 'Auto-renew',
      'plan.autoRenewOn': 'On',
      'plan.autoRenewOff': 'Off',
      'plan.balanceHint': 'Balance {v} — see the pay-as-you-go tab',
      'plan.balancePayg': 'Pay-as-you-go balance',
      'plan.balanceNote': 'Plan Credits are separate.',
      'plan.noSubscription': 'No Token Plan subscription: pay-as-you-go bills at list price.',
      'models.title': 'Model catalog',
      'models.count': '{n} text models',
      'models.search': 'Search model id or capability',
      'models.model': 'Model',
      'models.priceIn': 'Input ¥/1M',
      'models.priceOut': 'Output ¥/1M',
      'models.priceBoth': 'Price ¥/1M in / out',
      'models.creditsBoth': 'Credits/1M in / out',
      'models.vision': 'Vision',
      'models.tiers': '{n} price tiers',
      'models.onOff': 'Switchable',
      'models.credits': 'Credits/1M',
      'models.context': 'Context',
      'models.thinking': 'Thinking',
      'models.creditsNote': 'Credits burned per 1M tokens (price ×100, 1 credit = ¥0.01; not a published field).',
      'models.priceNote': 'Published list price: ¥/1M input / output.',
      'models.empty': 'No catalog yet — press Refresh.',
      'models.truncated': 'Showing the first {n}; narrow with search.',
      'routes.title': 'Provider routes',
      'routes.pickerNote': 'A channel without a key stays out of the picker.',
      'routes.keyEnv': 'Key env var',
      'routes.tokenPlan': 'Token Plan',
      'routes.payg': 'Pay as you go',
      'routes.models': '{n} models',
      'routes.live': 'Registered · {n} models',
      'routes.needModels': 'Refresh the catalog first — a route without rows has no models to offer.',
      'routes.notInConfig': 'Route not registered',
      'routes.broken': 'The routes could not be registered: {msg}',
      'keys.configured': 'Key configured',
      'keys.missing': 'No key',
      'keys.placeholder': 'Paste the key for {name}',
      'keys.save': 'Save key',
      'keys.saving': 'Saving…',
      'keys.clear': 'Clear',
      'keys.saved': 'Key written to the credential file; the next call uses it',
      'keys.cleared': 'Key cleared',
      'settings.title': 'Options',
      'settings.thinking': 'Thinking mode',
      'settings.thinkingAuto': 'Offer levels per model capability',
      'settings.thinkingOff': 'Off everywhere (no thinking params)',
      'settings.refresh': 'Auto refresh (minutes)',
      'settings.apiKeyEnv': 'Token Plan key env var',
      'settings.apiKeyEnvPayg': 'Pay-as-you-go key env var',
      'settings.save': 'Save',
      'settings.saved': 'Saved',
      'settings.catalogRefresh': 'Catalog rebuild (minutes)',
      'settings.cliPath': 'CLI path',
      'settings.cliPathHint': 'Empty resolves it: plugin data dir → global install',
      'settings.defaultEffort': 'Default thinking level',
      'settings.effortLearned': 'Whatever each route used last',
      'settings.effortOff': 'Off',
      'settings.effortLow': 'Low',
      'settings.effortMedium': 'Medium',
      'settings.effortHigh': 'High',
      'settings.rememberEffort': 'Remember the picker level',
      'settings.rememberEffortNote': 'Adopt picker changes as the route default',
      'models.countEnabled': '{on} of {n} enabled',
      'models.enabled': 'Enabled',
      'models.enabledNote': 'Disabled models stay out of the picker',
      'models.onlyThese': 'Keep only these {n}',
      'models.onlyTheseHint': 'Disable every model outside the current filter',
      'models.enableAll': 'Enable all',
      'models.disableAll': 'Select none',
      'models.pendingSave': 'Unsaved changes…',
      'models.saving': 'Saving…',
      'models.disableAllHint': 'Disable every model on this mode; with none enabled the picker offers nothing on this route.',
      'payg.monthCost': 'Pay-as-you-go cost (month)',
      'payg.freeTier': 'Free tier',
      'payg.freeTierCount': '{n} models have one',
      'payg.freeTierNote': 'Pay-as-you-go grants, unrelated to plan Credits',
      'payg.freeLeft': 'Left / total',
      'payg.freeReset': 'Resets',
      'payg.orderNote': 'Charging order: plan → boost packs → balance. Exhausted plans block calls; no fallback to pay-as-you-go.',
      'models.kind.textOnly': 'Text only',
      'models.noMatch': 'No model matches all these tags.',
      'models.clearFilters': 'Clear filters',
      'models.kind.multimodal': 'Multimodal',
      'models.kind.audio': 'Audio',
      'models.kind.reasoning': 'Thinking',
      'models.kind.thirdParty': 'Third-party',
      'models.catalogAt': 'Catalog fetched {time}',
      'models.catalogAge': 'Catalog fetched {time} · {n} min ago',
      'models.catalogStale': 'Older than {n} min — rebuilding in the background',
      'models.rebuild': 'Rebuild catalog',
      'models.rebuilding': 'Rebuilding…',
      'models.cardOwned': 'Provided by dsh-qianwen: models come from the Qianwen catalog; set the key here, nothing else.',
      'error.prefix': 'Error: ',
    }

    /* ------------------------------------------------------------------ */
    /* Host bridge                                                        */
    /* ------------------------------------------------------------------ */

    async function request(path, options = {}) {
      // 挂住的请求必须自己收尾：浏览器对同一个 origin 的连接数是有限的，
      // 一个永不结束的 fetch 会一直占着一条连接，把页面其它请求全堵死。
      const response = await fetch(`${BASE}${path}`, {
        method: options.method ?? 'GET',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal:
          typeof AbortSignal?.timeout === 'function'
            ? AbortSignal.timeout(options.timeoutMs ?? 12_000)
            : undefined,
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok && payload?.error === undefined && payload?.ok === undefined) {
        throw new Error(`${path} → HTTP ${response.status}`)
      }
      return payload
    }

    /* ------------------------------------------------------------------ */
    /* Presentation helpers                                               */
    /* ------------------------------------------------------------------ */

    function formatCredits(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value >= 1000 ? value.toLocaleString('zh-CN') : String(value)
    }

    function formatPrice(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      return value >= 1 ? value.toFixed(2) : String(Math.round(value * 100) / 100)
    }

    /**
     * 凭据服务按真实长度打码，长 Key 会把整张卡片撑破。只保留头尾可见段。
     */
    function shortenMask(value) {
      if (typeof value !== 'string' || value === '') return '••••'
      if (value.length <= 20) return value
      return `${value.slice(0, 8)}…${value.slice(-4)}`
    }

    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—'
      if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return date.toLocaleString('zh-CN', { hour12: false })
    }

    /** 只到分钟的时间戳，给「更新于 …」这类上下文用。 */
    function formatClock(value) {
      if (typeof value !== 'string' || value === '') return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    }

    /**
     * 「还剩 41 小时 17 分」这一段。登录令牌的有效期由服务端定死 48 小时，
     * CLI 没有续期接口，所以这里只做剩余量呈现，让用户知道什么时候会断。
     */
    function formatRemaining(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      if (ms <= 0) return '0m'
      const minutes = Math.floor(ms / 60_000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
      return `${Math.floor(hours / 24)}d ${hours % 24}h`
    }

    /** 令牌到期时刻与当前时刻的差；无法解析时返回 undefined。 */
    function expiryRemaining(expiresAt, now) {
      if (typeof expiresAt !== 'string' || expiresAt === '') return undefined
      const at = Date.parse(expiresAt)
      if (!Number.isFinite(at)) return undefined
      return at - now
    }

    /**
     * 每 `step` 毫秒自增一次的当前时刻。
     *
     * 倒计时自己带着这个心跳，页面本体不跟着重渲染——否则模型表（几百行）
     * 会被一个一秒一次的计时器拖着每秒重画。
     */
    function useNow(step) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), step)
        return () => clearInterval(timer)
      }, [step])
      return now
    }

    /** 账号卡里的「登录有效期」一格：剩余量、临期与过期提示、重新登录。 */
    function SessionExpiry({ t, expiresAt, onRenew, busy }) {
      const now = useNow(15_000)
      const left = expiryRemaining(expiresAt, now)
      const expired = left !== undefined && left <= 0
      // 六小时内算临期：48 小时的令牌临期时只剩一个工作日不到，值得提醒。
      const soon = left !== undefined && expired !== true && left < 6 * 3_600_000
      return h(
        React.Fragment,
        null,
        h('span', { className: 'qw-k' }, t('auth.expiresLabel')),
        h(
          'div',
          { className: 'qw-v', style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 } },
          h(
            'span',
            null,
            formatDate(expiresAt),
            left === undefined || expired
              ? null
              : h('span', { className: 'qw-hint', style: { margin: '0 0 0 8px', fontSize: '11.5px' } }, t('auth.expiresLeft', { d: formatRemaining(left) })),
          ),
          soon || expired
            ? h(
                'div',
                { className: 'qw-row', style: { gap: 8 } },
                h('span', { className: 'qw-hint', style: { margin: 0 } }, expired ? t('auth.expiresExpired') : t('auth.expiresSoon')),
                h(
                  'button',
                  { className: 'qw-btn', type: 'button', onClick: onRenew, disabled: busy === true },
                  t('auth.renew'),
                ),
              )
            : null,
        ),
      )
    }

    /** 授权链接自己的倒计时胶囊；窗口一关就把「我已授权」按钮换掉。 */
    function LoginWindow({ t, expiresAt }) {
      const now = useNow(1000)
      const left = expiryRemaining(expiresAt, now)
      if (left === undefined) return null
      if (left <= 0) return h('span', { className: 'qw-pill qw-pill-warn' }, t('auth.windowOver'))
      return h(
        'span',
        { className: `qw-pill ${left < 60_000 ? 'qw-pill-warn' : ''}` },
        t('auth.windowLeft', { n: Math.ceil(left / 1000) }),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.qw-page{display:flex;flex-direction:column;gap:16px;padding:4px 2px 28px;color:var(--dsw-alias-label-primary,#e8e8ea);font-size:13px;line-height:1.55}
.qw-head{display:flex;gap:12px;align-items:flex-start}
.qw-head-main{flex:1;min-width:0}
.qw-title{margin:0;font-size:20px;font-weight:600;line-height:1.4}
.qw-desc{margin:4px 0 0;color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);border-radius:12px;padding:16px}
.qw-card-title{margin:0 0 10px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.qw-card-note{margin:0 0 12px;color:var(--dsw-alias-label-tertiary,#9a9aa2);font-size:12px}
.qw-tabs{display:flex;gap:6px;margin:14px 0 10px}
.qw-tab{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-3,#202126);color:var(--dsw-alias-label-primary,inherit);border-radius:999px;padding:5px 16px;font-size:13px;cursor:pointer}
.qw-tab:hover{border-color:var(--dsw-alias-border-l3,#4a4b50)}
.qw-tab-on{background:var(--dsw-alias-fill-inverted,#e8e8ea);color:var(--dsw-alias-text-inverted,#17181c);border-color:transparent;font-weight:600}
.qw-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.qw-row-tight{gap:6px}
.qw-spread{display:flex;align-items:center;justify-content:space-between;gap:12px}
.qw-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:baseline}
.qw-k{color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-v{font-variant-numeric:tabular-nums}
.qw-pill{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:11.5px;border:1px solid var(--dsw-alias-border-l2,#3a3b40);background:var(--dsw-alias-bg-layer-2,#26272c);color:var(--dsw-alias-label-secondary,#c8c8ce)}
.qw-pill-ok{border-color:rgba(64,190,120,.45);color:#59d18c;background:rgba(64,190,120,.1)}
.qw-pill-warn{border-color:rgba(230,170,60,.45);color:#e0ab45;background:rgba(230,170,60,.1)}
.qw-pill-off{color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#3f4046);background:var(--dsw-alias-bg-layer-2,#2a2b31);color:inherit;font:inherit;font-size:12.5px;padding:5px 12px;border-radius:8px;cursor:pointer;transition:background .15s,border-color .15s}
.qw-btn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#2a2b31) 93%, currentColor);border-color:var(--dsw-alias-border-l3,#4a4b52)}
.qw-btn:disabled{opacity:1;background:var(--dsw-alias-bg-layer-2,#2a2b31);border-color:var(--dsw-alias-border-l1,#34353a);color:var(--dsw-alias-label-tertiary,#9a9aa2);cursor:default}
.qw-btn-primary{background:var(--dsw-alias-bg-accent,#2f6feb);border-color:transparent;color:#fff}
.qw-btn-primary:disabled{background:var(--dsw-alias-bg-layer-2,#2a2b31);border-color:var(--dsw-alias-border-l1,#34353a);color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-btn-primary:hover:not(:disabled){background:var(--dsw-alias-bg-accent-hover,#3b7bf5)}
.qw-link{color:var(--dsw-alias-label-link,#6aa4ff);word-break:break-all;font-size:12px}
.qw-bar{position:relative;height:8px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-border-l2,#8a8b93) 45%, transparent);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1,#34353a);overflow:hidden}
.qw-bar-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#3f7bf0,#6aa4ff)}
.qw-bar-fill.qw-bar-warn{background:linear-gradient(90deg,#c98b27,#e3b451)}
.qw-bar-fill.qw-bar-danger{background:linear-gradient(90deg,#c14b4b,#e06a6a)}
.qw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.qw-stat{border:1px solid var(--dsw-alias-border-l2,#33343a);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#26272c)}
.qw-stat-label{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-stat-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
.qw-input{appearance:none;border:1px solid var(--dsw-alias-border-l2,#3f4046);background:var(--dsw-alias-bg-layer-1,#212227);color:inherit;font:inherit;font-size:12.5px;padding:5px 10px;border-radius:8px;min-width:180px}
.qw-input-grow{flex:1 1 220px;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qw-group{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#34353a);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#212227)}
.qw-select{appearance:none;border:1px solid var(--dsw-alias-border-l2,#3f4046);background:var(--dsw-alias-bg-layer-2,#2a2b31);color:inherit;font:inherit;font-size:12.5px;padding:5px 8px;border-radius:8px;max-width:340px}
.qw-table{width:100%;border-collapse:collapse;font-size:12.5px}
.qw-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#9a9aa2);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#33343a);white-space:nowrap;position:sticky;top:0;background:var(--dsw-alias-bg-layer-3,#202126);z-index:1}
.qw-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#2c2d32);vertical-align:top}
.qw-table tr:hover td{background:var(--dsw-alias-bg-layer-2,#26272c)}
.qw-table-scroll{max-height:460px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,#33343a);border-radius:10px}
.qw-num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.qw-mono{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px}
.qw-err{color:#e08a8a;font-size:12.5px;margin:6px 0 0}
.qw-hint{color:var(--dsw-alias-label-tertiary,#9a9aa2);font-size:12px;margin:6px 0 0}
.qw-tag{display:inline-flex;align-items:center;line-height:16px;padding:0 6px;border-radius:5px;font-size:10.5px;border:1px solid var(--dsw-alias-border-l1,#34353a);background:color-mix(in srgb, currentColor 6%, transparent);color:var(--dsw-alias-label-tertiary,#9a9aa2);margin-left:6px;vertical-align:middle}
.qw-meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;margin-top:3px;font-size:11px;color:var(--dsw-alias-label-tertiary,#9a9aa2);font-variant-numeric:tabular-nums}
/* ---- 侧边栏额度条：贴在左下角设置按钮旁边 ---- */
.qw-quota{position:relative;display:flex;align-items:center;width:100%;min-width:0}
.qw-quota-btn{display:flex;align-items:center;gap:8px;width:100%;min-width:0;margin:0;padding:6px 8px;border:none;border-radius:9px;background:transparent;box-shadow:none;outline:none;appearance:none;color:var(--dsw-alias-label-secondary,#c3c3ca);cursor:pointer;font:inherit;font-size:13px;line-height:20px;text-align:left}
.qw-quota-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8e8ea)}
.qw-quota-btn[data-open]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.qw-quota-icon{flex:none;display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center}
.qw-quota-text{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;overflow:hidden;font-variant-numeric:tabular-nums}
.qw-quota-line{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qw-quota-btn[data-expired]{color:var(--dsw-alias-status-error,#e57373)}
.qw-quota-btn[data-expired] .qw-quota-icon{color:var(--dsw-alias-status-error,#e57373)}
.qw-quota-renew{margin-left:8px;font-size:12px;color:var(--dsw-alias-accent,#7aa2ff);white-space:nowrap}
.qw-quota-updated{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#9a9aa2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qw-quota-pct{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#9a9aa2);font-size:11.5px}
/* 浮层挂在 shell.overlay 上（frame 级），用 fixed 定位贴住侧栏那颗按钮：
   挂在侧栏 footer 里的 absolute 会被侧栏的 overflow 裁掉。 */
.qw-quota-panel{position:fixed;z-index:1200;width:250px;padding:12px;border:1px solid var(--dsw-alias-border-l2,#3f4046);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#202126);box-shadow:0 12px 34px rgba(0,0,0,.42);display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary,#e8e8ea)}
.qw-quota-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-variant-numeric:tabular-nums}
.qw-quota-row>span:first-child{color:var(--dsw-alias-label-tertiary,#9a9aa2);flex:none}
.qw-quota-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1,#2c2d32)}
.qw-quota-title{font-size:12.5px;font-weight:600}
.qw-quota-bar{height:6px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-border-l2,#8a8b93) 45%, transparent);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1,#34353a);overflow:hidden}
.qw-quota-bar>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4d8df7)}
.qw-quota-actions{display:flex;gap:8px;padding-top:4px}
/* ---- 模型页 provider 卡片上的归属说明 ---- */
.qw-managed{display:flex;align-items:flex-start;gap:6px;margin:6px 0 0;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9a9aa2)}
.qw-managed-icon{flex:none;display:inline-flex;margin-top:1px}
/* ---- 目录标签筛选 ---- */
.qw-chips{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px}
.qw-chip{padding:3px 9px;border:1px solid var(--dsw-alias-border-l2,#3f4046);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#b9bac1);font-size:11.5px;line-height:16px;cursor:pointer;font-variant-numeric:tabular-nums}
.qw-chip:hover{border-color:var(--dsw-alias-state-business-primary,#4d8df7);color:var(--dsw-alias-label-primary,#e8e8ea)}
.qw-chip-on{border-color:var(--dsw-alias-state-business-primary,#4d8df7);background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4d8df7) 18%, transparent);color:var(--dsw-alias-label-primary,#e8e8ea)}
.qw-row-off{opacity:.45}
`

    /* ------------------------------------------------------------------ */
    /* Page                                                               */
    /* ------------------------------------------------------------------ */

    function createPage(t) {
      const tr = (key, vars) => {
        const raw = t(key)
        const text = typeof raw === 'string' && raw !== '' && raw !== key ? raw : CJK[key] ?? key
        if (vars === undefined) return text
        return text.replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
      }

      return function QianwenPage() {
        const [status, setStatus] = React.useState(undefined)
        const [models, setModels] = React.useState(undefined)
        const [error, setError] = React.useState(undefined)
        const [busy, setBusy] = React.useState(undefined)
        const [query, setQuery] = React.useState('')
        /** 已选中的筛选标签：`kind:x` 或 `family:x`，多个之间取交集。 */
        const [filters, setFilters] = React.useState([])
        /** 当前模式 tab：'tokenPlan' | 'payg'。套餐额度、Provider、目录勾选都跟着它走。 */
        const [mode, setMode] = React.useState('tokenPlan')
        /** 尚未落盘的勾选改动：`{route, keep:Set}`，只属于一个模式。 */
        const [pending, setPending] = React.useState(undefined)
        /** 合并写正在飞行中（禁用批量按钮、显示「保存中」）。 */
        const [saveBusy, setSaveBusy] = React.useState(false)
        const latestWrite = React.useRef(undefined)
        const saveTimer = React.useRef(undefined)
        const [notice, setNotice] = React.useState(undefined)
        const [draft, setDraft] = React.useState(undefined)
        /** 每条通道的 Key 输入值，按 `target` 分开存，互不干扰。 */
        const [keyDraft, setKeyDraft] = React.useState({})
        const [keyBusy, setKeyBusy] = React.useState(undefined)
        /** 冷启动时后端先回一个空壳（首次刷新还没落盘），这里数着重试几次。 */
        const [retries, setRetries] = React.useState(0)

        const load = React.useCallback(async () => {
          // 每次尝试都计数：冷启动的空壳、卡住的请求、暂时失败都靠它收敛，
          // 否则页面会每两秒无限重试，把浏览器的连接池占满。
          setRetries((count) => count + 1)
          try {
            const payload = await request('/status')
            setStatus(payload)
            setError(undefined)
            if (payload?.settings !== undefined && draft === undefined) setDraft(payload.settings)
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          }
        }, [draft])

        const loadModels = React.useCallback(async () => {
          try {
            const payload = await request('/models')
            setModels(payload)
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          }
        }, [])

        React.useEffect(() => {
          void load()
          void loadModels()
        }, [load, loadModels])

        // 只在「后端还没准备好 / 正在刷新 / 正在等授权」时轮询，且有次数上限：
        // 一个拿不到数据的页面不该无限重试，那会把整页的请求都堵住。
        const polling =
          error === undefined &&
          retries < 12 &&
          (status?.ready !== true ||
            status?.refreshing === true ||
            status?.login?.status === 'polling' ||
            status?.login?.status === 'waiting')
        React.useEffect(() => {
          if (!polling) return undefined
          const timer = setInterval(() => {
            if (status?.ready !== true || status?.refreshing === true) void loadModels()
            void load()
          }, 2500)
          return () => clearInterval(timer)
        }, [polling, load, loadModels, status?.ready, status?.refreshing])

        const run = async (name, fn) => {
          setBusy(name)
          setNotice(undefined)
          try {
            return await fn()
          } catch (cause) {
            setError(String(cause?.message ?? cause))
            return undefined
          } finally {
            setBusy(undefined)
          }
        }

        const onRefresh = () =>
          run('refresh', async () => {
            await request('/refresh', { method: 'POST' })
            await load()
            await loadModels()
          })

        const onSignIn = () =>
          run('signin', async () => {
            const result = await request('/login/init', { method: 'POST' })
            if (result?.ok !== true) {
              setError(result?.error?.message ?? tr('auth.failed'))
              return
            }
            // 已登录时 CLI 不会给链接，只回一句「还有效」：这时候要说的不是
            // 「等待授权」，而是还要不要真的换一个会话。
            if (result.alreadyAuthenticated === true) {
              setNotice(tr('auth.stillValid', { d: formatRemaining(expiryRemaining(result.auth?.token?.expires_at, Date.now())) }))
              await load()
              return
            }
            setStatus((current) => (current === undefined ? current : { ...current, login: result.login }))
            await load()
          })

        /** 重建模型目录：目录只在过期后由后台重建，用户想立刻要新模型时用它。 */
        const onRebuildCatalog = () =>
          run('catalog', async () => {
            await request('/refresh', { method: 'POST' })
            await load()
            await loadModels()
            setNotice(tr('settings.saved'))
          })

        const onConfirm = () =>
          run('confirm', async () => {
            await request('/login/complete', { method: 'POST' })
            await load()
          })

        const onSignOut = () =>
          run('signout', async () => {
            await request('/logout', { method: 'POST' })
            await load()
          })

        /**
         * 改写当前模式的启用集合。停用存成每通道一份黑名单，所以这里只需要
         * 算出「不在启用集合里的 id」写进当前 tab 的那份清单，目录新增的模型
         * 自然默认启用。
         */
        const activeMode = MODES.find((item) => item.target === mode) ?? MODES[0]
        const isEnabledIn = (row, route) => (row.enabled ? row.enabled[route] !== false : true)
        /**
         * 勾选是本地即时的：点一下就翻，改动先在 `pending` 里攒着，停顿半秒
         * 合并成一次写。以前每勾一次都要串行走完 POST（含服务端等提交）+
         * 重拉 status + 重拉 models 三个来回，连点时每个都要转一圈圈。
         */
        const rowEnabled = (row) =>
          pending !== undefined && pending.route === activeMode.route
            ? pending.keep.has(row.id)
            : isEnabledIn(row, activeMode.route)

        const flushEnabled = async () => {
          const job = latestWrite.current
          if (job === undefined) return
          latestWrite.current = undefined
          setSaveBusy(true)
          try {
            await request('/settings', { method: 'POST', body: { [job.field]: job.disabled } })
            await loadModels()
          } catch (issue) {
            setError(String(issue?.message ?? issue))
            latestWrite.current = undefined
            setPending(undefined)
            await loadModels()
            setSaveBusy(false)
            void load()
            return
          }
          // 写期间用户又勾了：pending 换成新作业，它的定时器负责下一次落盘。
          const next = latestWrite.current
          setPending(next === undefined ? undefined : { route: next.route, keep: new Set(next.keep) })
          setSaveBusy(false)
          void load()
        }

        const queueEnabled = (keep) => {
          const all = (models?.models ?? []).map((row) => row.id)
          const keepSet = new Set(keep)
          const job = {
            route: activeMode.route,
            field: activeMode.field,
            keep,
            disabled: all.filter((id) => keepSet.has(id) !== true),
          }
          latestWrite.current = job
          setPending({ route: job.route, keep: new Set(job.keep) })
          if (saveTimer.current !== undefined) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => {
            saveTimer.current = undefined
            void flushEnabled()
          }, 500)
        }

        /** 离开当前模式前把攒着的勾选写掉，免得两份通道清单互相踩。 */
        const switchMode = (target) => {
          if (target === mode) return
          if (saveTimer.current !== undefined) {
            clearTimeout(saveTimer.current)
            saveTimer.current = undefined
            void flushEnabled()
          }
          setMode(target)
        }


        const toggleModel = (row) => {
          const enabledNow = (models?.models ?? []).filter(rowEnabled).map((item) => item.id)
          if (rowEnabled(row) !== true) return queueEnabled([...enabledNow, row.id])
          return queueEnabled(enabledNow.filter((id) => id !== row.id))
        }

        /** 「只留这些」：把当前筛选结果之外的模型在当前模式里全部停用。 */
        const onlyThese = (rowsToKeep) => queueEnabled(rowsToKeep.map((row) => row.id))
        const enableAll = () => queueEnabled((models?.models ?? []).map((row) => row.id))
        /** 「全不选」：当前模式清空启用集合，之后逐个勾回想要的。 */
        const disableAll = () => queueEnabled([])

        /**
         * 保存某条通道的 API Key。写入后 pi-ai 下一次调用就会解析到新值，
         * 不需要重启；保存成功时清空该通道的输入框。
         */
        const onSaveKey = (target) => async () => {
          const apiKey = (keyDraft[target] ?? '').trim()
          if (apiKey === '') return
          setKeyBusy(target)
          setError(undefined)
          try {
            const result = await request('/keys', { method: 'POST', body: { target, apiKey } })
            if (result?.ok === true) {
              setNotice(tr('keys.saved'))
              setKeyDraft((current) => ({ ...current, [target]: '' }))
              await load()
            } else {
              setError(result?.error ?? tr('common.failed'))
            }
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          } finally {
            setKeyBusy(undefined)
          }
        }

        /** 清除某条通道已保存的 Key。 */
        const onClearKey = (target) => async () => {
          setKeyBusy(target)
          setError(undefined)
          try {
            const result = await request('/keys/clear', { method: 'POST', body: { target } })
            if (result?.ok === true) {
              setNotice(tr('keys.cleared'))
              await load()
            } else {
              setError(result?.error ?? tr('common.failed'))
            }
          } catch (cause) {
            setError(String(cause?.message ?? cause))
          } finally {
            setKeyBusy(undefined)
          }
        }

        const onSave = () =>
          run('save', async () => {
            if (draft === undefined) return
            await request('/settings', { method: 'POST', body: draft })
            setNotice(tr('settings.saved'))
            await load()
            await loadModels()
          })

        /* ---- derived ---- */
        const auth = status?.auth
        const signedIn = auth?.authenticated === true
        const login = status?.login
        const individual = status?.subscription?.individual
        const credits = individual?.monthlyCredits
        const usedPct = typeof credits?.usedPct === 'number' ? credits.usedPct : undefined
        // 剩余与已用保持同一口径（两位小数），否则两个数相加凑不到 100。
        const usedShown = usedPct === undefined ? '—' : (Math.round(usedPct * 100) / 100).toFixed(2)
        const remainingShown = usedPct === undefined ? '—' : (Math.round((100 - usedPct) * 100) / 100).toFixed(2)
        const rows = models?.models ?? []
        const catalogAge = status?.catalog?.ageMinutes
        const catalogNote =
          status?.catalog?.refreshedAt === undefined
            ? undefined
            : catalogAge === undefined
              ? tr('models.catalogAt', { time: formatDate(status.catalog.refreshedAt) })
              : tr('models.catalogAge', { time: formatClock(status.catalog.refreshedAt), n: catalogAge })
        const routesError = status?.routesError
        const routesNote =
          routesError === undefined ? undefined : tr('routes.broken', { msg: routesError })
        const filtered = query.trim() === ''
          ? rows
          : rows.filter((row) => {
              const needle = query.trim().toLowerCase()
              return (
                row.id.toLowerCase().includes(needle) ||
                (row.description ?? '').toLowerCase().includes(needle) ||
                (row.tags ?? []).some((tag) => String(tag).toLowerCase().includes(needle))
              )
            })
        /* ---- 标签筛选 ---------------------------------------------------- */
        // 目录有一百多个模型，靠搜索框逐个找不现实。能力桶与系列都由后端从
        // 目录行推导（`kinds` / `family`），这里只负责开合、计数与交集。
        /* 筛选语义分两组：能力桶之间取交集（多模态 ∧ 思考），系列桶之间取并集
           （qwen ∨ kimi）——两个系列交集恒空，所以同族必须 OR。textOnly 与
           multimodal 互斥，thirdParty 与一切系列互斥（它本身就是"第三方系列"
           的并集），点一个自动清掉对立面，防止叠出自相矛盾的空集。 */
        const KINDS = ['multimodal', 'audio', 'reasoning']
        const kindCounts = new Map()
        const familyCounts = new Map()
        let textOnlyCount = 0
        let thirdPartyCount = 0
        for (const row of rows) {
          for (const kind of row.kinds ?? []) kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)
          if ((row.kinds ?? []).includes('thirdParty')) thirdPartyCount += 1
          else if (!(row.kinds ?? []).includes('multimodal')) textOnlyCount += 1
          familyCounts.set(row.family ?? 'other', (familyCounts.get(row.family ?? 'other') ?? 0) + 1)
        }
        const matchesFilter = (row, filter) => {
          if (filter.startsWith('kind:')) {
            const kind = filter.slice(5)
            if (kind === 'textOnly') return !(row.kinds ?? []).includes('multimodal')
            return (row.kinds ?? []).includes(kind)
          }
          if (filter.startsWith('tp:')) return (row.kinds ?? []).includes('thirdParty')
          return (row.family ?? 'other') === filter.slice(7)
        }
        const chipFiltered =
          filters.length === 0
            ? filtered
            : filtered.filter((row) => {
                const kinds = filters.filter((item) => item.startsWith('kind:'))
                const fams = filters.filter((item) => !item.startsWith('kind:'))
                return (
                  kinds.every((item) => matchesFilter(row, item)) &&
                  (fams.length === 0 || fams.some((item) => matchesFilter(row, item)))
                )
              })
        const visible = chipFiltered.slice(0, 200)
        const enabledCount = rows.filter(rowEnabled).length
        /* 互斥对：点了就清掉对立面，而不是叠出一个恒空的交集。 */
        const toggleFilter = (filter) =>
          setFilters((current) => {
            if (current.includes(filter)) return current.filter((item) => item !== filter)
            const drop = new Set()
            if (filter === 'kind:textOnly') drop.add('kind:multimodal')
            if (filter === 'kind:multimodal') drop.add('kind:textOnly')
            const kept = current.filter((item) => !drop.has(item))
            if (filter === 'tp:third') return [...kept.filter((item) => !item.startsWith('family:')), filter]
            return [...kept.filter((item) => item !== 'tp:third'), filter]
          })
        const rowsShown = visible

        const routeList =
          Array.isArray(status?.routes) && status.routes.length > 0 ? status.routes : FALLBACK_ROUTES
        const modelsReady = (status?.catalog?.size ?? 0) > 0
        const loginUrl = login?.status === 'waiting' || login?.status === 'polling' ? login.url : undefined

        /* ---- 按量模式的额度卡：余额、本月按量花费、免费额度 ---------------- */
        const paygUsage = status?.usage?.pay_as_you_go
        const paygPeriod = status?.usage?.period
        const freeTier = Array.isArray(status?.usage?.free_tier) ? status.usage.free_tier : []
        const statCell = (label, value, note) =>
          h(
            'div',
            { className: 'qw-stat' },
            h('div', { className: 'qw-stat-label' }, label),
            h('div', { className: 'qw-stat-value', style: { fontSize: 14 } }, value),
            note === undefined ? null : h('div', { className: 'qw-stat-label', style: { marginTop: 2 } }, note),
          )
        const paygPlan =
          signedIn !== true
            ? h('p', { className: 'qw-hint' }, tr('auth.hint'))
            : h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                h(
                  'div',
                  { className: 'qw-grid' },
                  statCell(
                    tr('plan.balance'),
                    status?.balance?.availableAmount === undefined
                      ? '—'
                      : `${status.balance.availableAmount} ${status.balance.currency ?? ''}`,
                    status?.balance?.status === undefined ? undefined : String(status.balance.status),
                  ),
                  statCell(
                    tr('payg.monthCost'),
                    paygUsage?.total?.cost === undefined
                      ? '—'
                      : `${paygUsage.total.cost} ${paygUsage.total.currency ?? ''}`,
                    paygPeriod === undefined ? undefined : `${paygPeriod.from ?? '—'} → ${paygPeriod.to ?? '—'}`,
                  ),
                  statCell(
                    tr('payg.freeTier'),
                    freeTier.length === 0 ? tr('common.none') : tr('payg.freeTierCount', { n: freeTier.length }),
                    tr('payg.freeTierNote'),
                  ),
                ),
                freeTier.length === 0
                  ? null
                  : h(
                      'div',
                      { className: 'qw-table-scroll' },
                      h(
                        'table',
                        { className: 'qw-table' },
                        h(
                          'thead',
                          null,
                          h(
                            'tr',
                            null,
                            h('th', null, tr('models.model')),
                            h('th', { className: 'qw-num' }, tr('payg.freeLeft')),
                            h('th', { className: 'qw-num' }, tr('payg.freeReset')),
                          ),
                        ),
                        h(
                          'tbody',
                          null,
                          freeTier.slice(0, 12).map((item) =>
                            h(
                              'tr',
                              { key: item.model_id },
                              h('td', null, h('div', { className: 'qw-mono' }, item.model_id)),
                              h(
                                'td',
                                { className: 'qw-num' },
                                `${formatTokens(item.quota?.remaining)} ${item.quota?.unit ?? ''} / ${formatTokens(item.quota?.total)}`,
                              ),
                              h('td', { className: 'qw-num' }, formatDate(item.quota?.resetDate)),
                            ),
                          ),
                        ),
                      ),
                    ),
                h(
                  'p',
                  { className: 'qw-hint', style: { margin: 0 } },
                  `${tr('payg.orderNote')}`,
                ),
              )

        return h(
          'div',
          { className: 'qw-page' },
          h(
            'div',
            { className: 'qw-head', key: 'head' },
            h('div', { className: 'qw-head-main' }, [
              h('h1', { className: 'qw-title', key: 'title' }, tr('page.title')),
              h('p', { className: 'qw-desc', key: 'desc' }, tr('page.desc')),
            ]),
            h(
              'button',
              {
                className: 'qw-btn',
                key: 'refresh',
                onClick: onRefresh,
                disabled: busy !== undefined,
              },
              busy === 'refresh' || status?.refreshing === true
                ? tr('common.refreshing')
                : error === undefined
                  ? tr('common.refresh')
                  : tr('common.retry'),
            ),
          ),

          error === undefined
            ? null
            : h('p', { className: 'qw-err', key: 'error' }, `${tr('error.prefix')}${error}`),
          status === undefined && error === undefined
            ? h('p', { className: 'qw-hint', key: 'loading' }, tr('common.loading'))
            : null,
          notice === undefined ? null : h('p', { className: 'qw-hint', key: 'notice' }, notice),

          /* ---------------- account card ---------------- */
          h(
            'section',
            { className: 'qw-card', key: 'account' },
            h(
              'div',
              { className: 'qw-spread' },
              h('h2', { className: 'qw-card-title' }, tr('auth.label')),
              h(
                'div',
                { className: 'qw-row qw-row-tight' },
                status === undefined
                  ? h('span', { className: 'qw-pill' }, tr('common.checking'))
                  : h(
                      'span',
                      { className: `qw-pill ${status?.cli?.installed === true ? 'qw-pill-ok' : 'qw-pill-warn'}` },
                      `${tr('cli.label')} · ${status?.cli?.installed === true ? tr('cli.installed') : tr('cli.missing')}`,
                    ),
                status === undefined
                  ? null
                  : h(
                      'span',
                      { className: `qw-pill ${signedIn ? 'qw-pill-ok' : 'qw-pill-off'}` },
                      signedIn ? tr('auth.signedIn') : tr('auth.signedOut'),
                    ),
                status === undefined
                  ? null
                  : signedIn
                    ? h('button', { className: 'qw-btn', onClick: onSignOut, disabled: busy !== undefined }, tr('auth.signOut'))
                    : h(
                        'button',
                        {
                          className: 'qw-btn qw-btn-primary',
                          onClick: onSignIn,
                          disabled: busy !== undefined || status?.cli?.installed !== true,
                        },
                        tr('auth.signIn'),
                      ),
              ),
            ),
            status !== undefined && status?.cli?.installed !== true
              ? h('p', { className: 'qw-hint' }, tr('cli.missingHint'))
              : null,
            signedIn
              ? h(
                  'div',
                  { className: 'qw-kv', style: { marginTop: 10 } },
                  h('span', { className: 'qw-k' }, 'aliyunId'),
                  h('span', { className: 'qw-v' }, auth?.user?.aliyunId ?? '—'),
                  h(SessionExpiry, {
                    t: tr,
                    expiresAt: auth?.token?.expires_at,
                    onRenew: onSignIn,
                    busy: busy !== undefined,
                  }),
                )
              : null,
            loginUrl === undefined
              ? null
              : h(
                  'div',
                  { className: 'qw-card', style: { marginTop: 12, padding: 12 } },
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-pill qw-pill-warn' }, tr('auth.waiting')),
                    h(LoginWindow, { t: tr, expiresAt: login?.expiresAt }),
                    h(
                      'a',
                      { className: 'qw-btn', href: loginUrl, target: '_blank', rel: 'noreferrer' },
                      tr('auth.openLink'),
                    ),
                    login?.status === 'waiting'
                      ? h(
                          'button',
                          { className: 'qw-btn qw-btn-primary', onClick: onConfirm, disabled: busy !== undefined },
                          tr('auth.confirmed'),
                        )
                      : h('span', { className: 'qw-pill' }, tr('auth.completing')),
                  ),
                  h('p', { className: 'qw-hint' }, tr('auth.hint')),
                ),
            login?.status === 'failed'
              ? h('p', { className: 'qw-err' }, `${tr('auth.failed')}：${login.message ?? ''}`)
              : null,
          ),

          /* ---------------- 模式 tab ---------------- */
          // 套餐与额度、Provider 对接、模型目录都按模式分家：token plan 与按量
          // 是两条独立通道，各自的额度、Key、启用清单都不通用。
          h(
            'div',
            { className: 'qw-tabs', key: 'modes' },
            MODES.map((item) =>
              h(
                'button',
                {
                  key: item.target,
                  type: 'button',
                  className: `qw-tab${mode === item.target ? ' qw-tab-on' : ''}`,
                  onClick: () => switchMode(item.target),
                },
                tr(item.labelKey),
              ),
            ),
          ),

          /* ---------------- plan card ---------------- */
          h(
            'section',
            { className: 'qw-card', key: 'plan' },
            h('h2', { className: 'qw-card-title' }, tr('plan.title')),
            activeMode.target === 'payg'
              ? paygPlan
              : signedIn !== true
              ? h('p', { className: 'qw-hint' }, tr('auth.hint'))
              : individual === undefined
                ? h('p', { className: 'qw-hint' }, tr('common.reading'))
                : h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                    h(
                      'div',
                      { className: 'qw-grid' },
                      h(
                        'div',
                        { className: 'qw-stat' },
                        h('div', { className: 'qw-stat-label' }, tr('plan.name')),
                        h('div', { className: 'qw-stat-value', style: { fontSize: 14 } }, individual?.name ?? individual?.edition ?? '—'),
                        h(
                          'div',
                          { className: 'qw-stat-label', style: { marginTop: 2 } },
                          `${individual?.status ?? ''} · ${tr('plan.remainingDays', { n: individual?.remainingDays ?? '—' })}`,
                        ),
                      ),
                      h(
                        'div',
                        { className: 'qw-stat' },
                        h('div', { className: 'qw-stat-label' }, tr('plan.remaining')),
                        h(
                          'div',
                          { className: 'qw-stat-value' },
                          usedPct === undefined ? '—' : `${remainingShown}%`,
                        ),
                        h(
                          'div',
                          { className: 'qw-bar', style: { marginTop: 6 } },
                          h('div', {
                            className: `qw-bar-fill ${usedPct !== undefined && usedPct > 90 ? 'qw-bar-danger' : usedPct !== undefined && usedPct > 70 ? 'qw-bar-warn' : ''}`,
                            style: { width: `${Math.min(100, Math.max(0, usedPct ?? 0))}%` },
                          }),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'qw-stat' },
                        h('div', { className: 'qw-stat-label' }, tr('plan.reset')),
                        h('div', { className: 'qw-stat-value', style: { fontSize: 13, fontWeight: 500 } }, formatDate(credits?.resetTime)),
                      ),
                      h(
                        'div',
                        { className: 'qw-stat' },
                        h('div', { className: 'qw-stat-label' }, tr('plan.autoRenew')),
                        h(
                          'div',
                          { className: 'qw-stat-value', style: { fontSize: 14 } },
                          individual?.autoRenew?.enabled === true ? tr('plan.autoRenewOn') : tr('plan.autoRenewOff'),
                        ),
                        h(
                          'div',
                          { className: 'qw-stat-label', style: { marginTop: 2 } },
                          tr('plan.balanceHint', { v: status?.balance?.availableAmount === undefined ? '—' : `${status.balance.availableAmount} ${status.balance.currency ?? ''}` }),
                        ),
                      ),
                    ),
                    individual?.period?.start === undefined
                      ? null
                      : h(
                          'p',
                          { className: 'qw-hint', style: { margin: 0 } },
                          `${tr('plan.period')}：${formatDate(individual.period.start)} → ${formatDate(individual.period.end)}`,
                        ),
                    Array.isArray(status?.subscription?.creditPacks) && status.subscription.creditPacks.length > 0
                      ? h(
                          'p',
                          { className: 'qw-hint', style: { margin: 0 } },
                          `${tr('plan.creditPacks')}：${status.subscription.creditPacks.length}`,
                        )
                      : null,
                    h(
                      'p',
                      { className: 'qw-hint', style: { margin: 0 } },
                      `${tr('plan.used', { n: usedShown })} · ${status?.catalog?.refreshedAt === undefined ? '' : formatDate(status.catalog.refreshedAt)}`,
                    ),
                  ),
          ),

          /* ---------------- routes card ---------------- */
          h(
            'section',
            { className: 'qw-card', key: 'routes' },
            h('h2', { className: 'qw-card-title' }, tr('routes.title')),
            h('p', { className: 'qw-card-note' }, tr('routes.pickerNote')),
            routesNote === undefined ? null : h('p', { className: 'qw-hint' }, routesNote),
            modelsReady
              ? null
              : h('p', { className: 'qw-hint' }, tr('routes.needModels')),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              // 只渲染当前模式的通道：Key、端点、模型数都各归各的 tab。
              routeList
                .filter((route) => route.key === activeMode.route)
                .map((route) => {
                // `route.key` 是 pi-ai 的路由名；`target` 是本插件区分两条通道的
                // 短名，Key 按 target 存取，所以两组 Key 永远互不覆盖。
                const target = route.key === PAYG_ROUTE ? 'payg' : 'tokenPlan'
                const configured = route.credential?.configured === true
                const busyHere = keyBusy === target
                return h(
                  'div',
                  { className: 'qw-group', key: route.key },
                  h(
                    'div',
                    { className: 'qw-spread' },
                    h(
                      'div',
                      { className: 'qw-row qw-row-tight' },
                      route.credential === undefined
                        ? h('span', { className: 'qw-pill' }, tr('common.checking'))
                        : configured
                          ? h('span', { className: 'qw-pill qw-pill-ok' }, tr('keys.configured'))
                          : h('span', { className: 'qw-pill qw-pill-off' }, tr('keys.missing')),
                    ),
                    h(
                      'span',
                      { className: 'qw-pill qw-pill-off' },
                      route.present === true
                        ? tr('routes.live', { n: route.presentModelCount ?? 0 })
                        : route.present === false
                          ? tr('routes.notInConfig')
                          : modelsReady
                            ? tr('routes.models', { n: rows.length })
                            : tr('common.checking'),
                    ),
                  ),
                  h('div', { className: 'qw-mono qw-hint' }, route.baseURL),
                  h(
                    'div',
                    { className: 'qw-row qw-row-tight' },
                    h(
                      'span',
                      { className: 'qw-hint' },
                      configured
                        ? `${route.apiKeyEnv} · ${shortenMask(route.credential?.masked)}`
                        : `${tr('routes.keyEnv')}: ${route.apiKeyEnv}`,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'qw-row qw-row-tight' },
                    h('input', {
                      className: 'qw-input qw-input-grow',
                      type: 'password',
                      autoComplete: 'off',
                      placeholder: tr('keys.placeholder', { name: route.apiKeyEnv }),
                      value: keyDraft[target] ?? '',
                      onChange: (event) => setKeyDraft((current) => ({ ...current, [target]: event.target.value })),
                    }),
                    h(
                      'button',
                      {
                        className: 'qw-btn qw-btn-primary',
                        onClick: onSaveKey(target),
                        disabled: busyHere || (keyDraft[target] ?? '').trim() === '',
                      },
                      busyHere ? tr('keys.saving') : tr('keys.save'),
                    ),
                    configured
                      ? h(
                          'button',
                          { className: 'qw-btn', onClick: onClearKey(target), disabled: busyHere },
                          tr('keys.clear'),
                        )
                      : null,
                  ),
                )
              }),
            ),
          ),

          /* ---------------- catalog card ---------------- */
          h(
            'section',
            { className: 'qw-card', key: 'catalog' },
            h(
              'div',
              { className: 'qw-spread' },
              h(
                'h2',
                { className: 'qw-card-title' },
                tr('models.title'),
                h(
                  'span',
                  { className: 'qw-tag' },
                  modelsReady
                    ? tr('models.countEnabled', { on: enabledCount, n: rows.length })
                    : tr('common.reading'),
                ),
              ),
              h(
                'div',
                { className: 'qw-row qw-row-tight' },
                h('input', {
                  className: 'qw-input',
                  placeholder: tr('models.search'),
                  value: query,
                  onChange: (event) => setQuery(event.target.value),
                }),
                // 目录默认六小时才重建一次；想立刻拿到平台新增的模型就用这个。
                h(
                  'button',
                  {
                    className: 'qw-btn',
                    type: 'button',
                    onClick: onRebuildCatalog,
                    disabled: busy !== undefined || status?.refreshing === true,
                    title: tr('models.rebuild'),
                  },
                  busy === 'catalog' ? tr('models.rebuilding') : tr('models.rebuild'),
                ),
              ),
            ),
            h(
              'p',
              { className: 'qw-card-note' },
              activeMode.target === 'payg' ? tr('models.priceNote') : tr('models.creditsNote'),
            ),
            h(
              'p',
              { className: 'qw-card-note' },
              catalogNote === undefined
                ? tr('common.reading')
                : status?.catalog?.stale === true
                  ? tr('models.catalogStale', { n: status?.catalog?.refreshMinutes ?? 360 })
                  : catalogNote,
            ),
            rows.length === 0
              ? h(
                  'p',
                  { className: 'qw-hint', style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('span', null, modelsReady ? tr('models.empty') : tr('common.reading')),
                  h(
                    'button',
                    { className: 'qw-btn', onClick: onRefresh, disabled: busy !== undefined },
                    tr('common.refresh'),
                  ),
                )
              : h(
                  'div',
                  null,
                  /* 标签筛选：能力桶之间交集，系列桶之间并集；互斥的两条
                     （纯文本/多模态、第三方/具体系列）点了会自动取消对面。 */
                  h(
                    'div',
                    { className: 'qw-chips' },
                    KINDS.filter((kind) => (kindCounts.get(kind) ?? 0) > 0).map((kind) =>
                      h(
                        'button',
                        {
                          key: `kind:${kind}`,
                          type: 'button',
                          className: `qw-chip${filters.includes(`kind:${kind}`) ? ' qw-chip-on' : ''}`,
                          onClick: () => toggleFilter(`kind:${kind}`),
                        },
                        `${tr(`models.kind.${kind}`)} ${kindCounts.get(kind)}`,
                      ),
                    ),
                    textOnlyCount > 0
                      ? h(
                          'button',
                          {
                            key: 'kind:textOnly',
                            type: 'button',
                            className: `qw-chip${filters.includes('kind:textOnly') ? ' qw-chip-on' : ''}`,
                            onClick: () => toggleFilter('kind:textOnly'),
                          },
                          `${tr('models.kind.textOnly')} ${textOnlyCount}`,
                        )
                      : null,
                    thirdPartyCount > 0
                      ? h(
                          'button',
                          {
                            key: 'tp:third',
                            type: 'button',
                            className: `qw-chip${filters.includes('tp:third') ? ' qw-chip-on' : ''}`,
                            onClick: () => toggleFilter('tp:third'),
                          },
                          `${tr('models.kind.thirdParty')} ${thirdPartyCount}`,
                        )
                      : null,
                    [...familyCounts.entries()]
                      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                      .map(([family, count]) =>
                        h(
                          'button',
                          {
                            key: `family:${family}`,
                            type: 'button',
                            className: `qw-chip${filters.includes(`family:${family}`) ? ' qw-chip-on' : ''}`,
                            onClick: () => toggleFilter(`family:${family}`),
                          },
                          `${family} ${count}`,
                        ),
                      ),
                  ),
                  h(
                    'div',
                    { className: 'qw-row qw-row-tight', style: { margin: '4px 0 8px' } },
                    h(
                      'span',
                      { className: 'qw-hint', style: { flex: 1 } },
                      saveBusy
                        ? tr('models.saving')
                        : pending !== undefined && pending.route === activeMode.route
                          ? tr('models.pendingSave')
                          : tr('models.enabledNote'),
                    ),
                    h(
                      'button',
                      {
                        className: 'qw-btn',
                        type: 'button',
                        disabled: busy !== undefined || chipFiltered.length === 0,
                        title: tr('models.onlyTheseHint'),
                        onClick: () => onlyThese(chipFiltered),
                      },
                      tr('models.onlyThese', { n: chipFiltered.length }),
                    ),
                    h(
                      'button',
                      {
                        className: 'qw-btn',
                        type: 'button',
                        disabled: busy !== undefined || enabledCount === rows.length,
                        onClick: enableAll,
                      },
                      tr('models.enableAll'),
                    ),
                    h(
                      'button',
                      {
                        className: 'qw-btn',
                        type: 'button',
                        disabled: busy !== undefined || enabledCount === 0,
                        title: tr('models.disableAllHint'),
                        onClick: disableAll,
                      },
                      tr('models.disableAll'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'qw-table-scroll' },
                    chipFiltered.length === 0
                      ? h(
                          'div',
                          { className: 'qw-row qw-row-tight', style: { padding: '14px 10px' } },
                          h('span', { className: 'qw-hint', style: { flex: 1 } }, tr('models.noMatch')),
                          h(
                            'button',
                            {
                              className: 'qw-btn',
                              type: 'button',
                              onClick: () => setFilters([]),
                            },
                            tr('models.clearFilters'),
                          ),
                        )
                      : null,
                    h(
                      'table',
                      { className: 'qw-table' },
                      h(
                        'thead',
                        null,
                        h(
                          'tr',
                          null,
                          h('th', { className: 'qw-num' }, tr('models.enabled')),
                          h('th', null, tr('models.model')),
                          // 价格列跟着模式走：套餐侧关心 Credits，按量侧关心 ¥。
                          h(
                            'th',
                            { className: 'qw-num' },
                            activeMode.target === 'payg' ? tr('models.priceBoth') : tr('models.creditsBoth'),
                          ),
                          h('th', { className: 'qw-num' }, tr('models.thinking')),
                        ),
                      ),
                      h(
                        'tbody',
                        null,
                        rowsShown.map((row) =>
                          h(
                            'tr',
                            { key: row.id, className: rowEnabled(row) !== true ? 'qw-row-off' : undefined },
                            h(
                              'td',
                              { className: 'qw-num' },
                              h('input', {
                                type: 'checkbox',
                                checked: rowEnabled(row),
                                disabled: busy !== undefined,
                                onChange: () => toggleModel(row),
                                'aria-label': `${tr('models.enabled')} · ${tr(activeMode.labelKey)}`,
                              }),
                            ),
                            h(
                              'td',
                              null,
                              h('div', { className: 'qw-mono' }, row.id),
                              h(
                                'div',
                                { className: 'qw-meta' },
                                h('span', null, formatTokens(row.contextWindow)),
                                row.vision ? h('span', null, tr('models.vision')) : null,
                                row.tiers !== undefined && row.tiers.length > 1
                                  ? h('span', null, tr('models.tiers', { n: row.tiers.length }))
                                  : null,
                              ),
                            ),
                            h(
                              'td',
                              { className: 'qw-num' },
                              activeMode.target === 'payg'
                                ? `${formatPrice(row.price?.input)} / ${formatPrice(row.price?.output)}`
                                : `${formatCredits(row.creditsPerMillionInput)} / ${formatCredits(row.creditsPerMillionOutput)}`,
                            ),
                            h(
                              'td',
                              { className: 'qw-num' },
                              row.reasoning
                                ? h('span', { className: 'qw-pill qw-pill-ok' }, tr('models.onOff'))
                                : h('span', { className: 'qw-pill qw-pill-off' }, '—'),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            chipFiltered.length > rowsShown.length
              ? h('p', { className: 'qw-hint' }, tr('models.truncated', { n: rowsShown.length }))
              : null,
          ),

          /* ---------------- options card ---------------- */
          h(
            'section',
            { className: 'qw-card', key: 'options' },
            h(
              'div',
              { className: 'qw-spread' },
              h('h2', { className: 'qw-card-title' }, tr('settings.title')),
              h(
                'button',
                { className: 'qw-btn', onClick: onSave, disabled: busy !== undefined || draft === undefined },
                tr('settings.save'),
              ),
            ),
            draft === undefined
              ? h('p', { className: 'qw-hint' }, tr('common.reading'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.thinking')),
                    h(
                      'select',
                      {
                        className: 'qw-select',
                        value: draft.thinkingMode ?? 'auto',
                        onChange: (event) => setDraft({ ...draft, thinkingMode: event.target.value }),
                      },
                      h('option', { value: 'auto' }, tr('settings.thinkingAuto')),
                      h('option', { value: 'off' }, tr('settings.thinkingOff')),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.defaultEffort')),
                    h(
                      'select',
                      {
                        className: 'qw-select',
                        value: draft.defaultThinkingEffort ?? '',
                        onChange: (event) => setDraft({ ...draft, defaultThinkingEffort: event.target.value }),
                      },
                      h('option', { value: '' }, tr('settings.effortLearned')),
                      h('option', { value: 'off' }, tr('settings.effortOff')),
                      h('option', { value: 'low' }, tr('settings.effortLow')),
                      h('option', { value: 'medium' }, tr('settings.effortMedium')),
                      h('option', { value: 'high' }, tr('settings.effortHigh')),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.rememberEffort')),
                    h('label', { className: 'qw-hint', style: { display: 'flex', alignItems: 'center', gap: 8 } },
                      h('input', {
                        type: 'checkbox',
                        checked: draft.rememberThinkingEffort !== false,
                        onChange: (event) => setDraft({ ...draft, rememberThinkingEffort: event.target.checked }),
                      }),
                      tr('settings.rememberEffortNote'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.apiKeyEnv')),
                    h('input', {
                      className: 'qw-input',
                      value: draft.tokenPlanApiKeyEnv ?? '',
                      onChange: (event) => setDraft({ ...draft, tokenPlanApiKeyEnv: event.target.value }),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.apiKeyEnvPayg')),
                    h('input', {
                      className: 'qw-input',
                      value: draft.paygApiKeyEnv ?? '',
                      onChange: (event) => setDraft({ ...draft, paygApiKeyEnv: event.target.value }),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.cliPath')),
                    h('input', {
                      className: 'qw-input',
                      placeholder: tr('settings.cliPathHint'),
                      value: draft.cliPath ?? '',
                      onChange: (event) => setDraft({ ...draft, cliPath: event.target.value }),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.refresh')),
                    h('input', {
                      className: 'qw-input',
                      type: 'number',
                      min: 1,
                      max: 240,
                      style: { minWidth: 90 },
                      value: draft.refreshMinutes ?? 10,
                      onChange: (event) => setDraft({ ...draft, refreshMinutes: Number(event.target.value) }),
                    }),
                  ),
                  h(
                    'div',
                    { className: 'qw-row' },
                    h('span', { className: 'qw-k', style: { minWidth: 150 } }, tr('settings.catalogRefresh')),
                    h('input', {
                      className: 'qw-input',
                      type: 'number',
                      min: 1,
                      max: 10_080,
                      style: { minWidth: 90 },
                      value: draft.catalogRefreshMinutes ?? 360,
                      onChange: (event) => setDraft({ ...draft, catalogRefreshMinutes: Number(event.target.value) }),
                    }),
                  ),
                ),
          ),
        )
      }
    }

    /* ------------------------------------------------------------------ */
    /* Plugin                                                             */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale']

    function QianwenIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('circle', { cx: 12, cy: 12, r: 9.2, stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.55 }),
        h('path', {
          d: 'M12 5.2c-2.6 2.3-4.1 4.6-4.1 6.9 0 2.4 1.8 4.3 4.1 4.3s4.1-1.9 4.1-4.3c0-2.3-1.5-4.6-4.1-6.9Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M12 12.4v6.3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    function apply(ctx) {
      const namespace = NAMESPACE
      ctx.effect(
        () => ctx.locale.register(namespace, { zh: CJK, en: EN }),
        'dsh-qianwen: settings copy',
      )
      const t = ctx.locale.bind(namespace)
      // 侧边栏额度条不在设置页里渲染，样式表必须在组合期注入一次。
      ctx.effect(() => {
        const element = document.createElement('style')
        element.dataset.plugin = 'dsh-qianwen'
        element.textContent = CSS
        document.head.appendChild(element)
        return () => {
          element.remove()
        }
      }, 'dsh-qianwen: styles')
      const Inner = createPage(t)
      /** 渲染抛异常时显示可读错误，而不是让整块设置区变空白。 */
      class PageBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: undefined }
        }
        static getDerivedStateFromError(error) {
          return { error }
        }
        componentDidCatch(error) {
          console.error('[dsh-qianwen] settings page crashed', error)
        }
        render() {
          if (this.state.error === undefined) return this.props.children
          const message = String(this.state.error?.message ?? this.state.error)
          return h(
            'div',
            { className: 'qw-page' },
            h(
              'div',
              { className: 'qw-card' },
              h('div', { className: 'qw-card-title' }, '千问设置页渲染出错'),
              h('div', { className: 'qw-hint' }, message),
              h('div', { className: 'qw-hint' }, '请点右上角「刷新」重试；若持续出现请把这条信息反馈给插件作者。'),
            ),
          )
        }
      }
      const Page = (props) => h(PageBoundary, null, h(Inner, props))

      /* ---------------------------------------------------------------- */
      /* Quota surfaces: sidebar footer strip + model menu row             */
      /* ---------------------------------------------------------------- */

      /**
       * 订阅 `/summary` 的小型只读 store：侧边栏额度条与模型菜单行共享同一份
       * 快照，避免两个入口各自轮询。首个订阅者激活 60s 轮询，最后一个取消时停表。
       */
      function createQuotaStore() {
        let snapshot = { summary: undefined, error: undefined, read: false }
        const listeners = new Set()
        let inFlight
        let timer

        const publish = (next) => {
          snapshot = next
          for (const listener of [...listeners]) listener()
        }

        const load = () => {
          if (inFlight !== undefined) return inFlight
          inFlight = (async () => {
            try {
              const body = await request('/summary')
              publish({ summary: body, error: undefined, read: true })
            } catch (error) {
              publish({
                summary: snapshot.summary,
                error: String(error?.message ?? error),
                read: true,
              })
            } finally {
              inFlight = undefined
            }
          })()
          return inFlight
        }

        return {
          getSnapshot: () => snapshot,
          subscribe: (listener) => {
            listeners.add(listener)
            if (listeners.size === 1) {
              void load()
              // 额度变化很慢，没必要频繁问；上一次出错就拉长间隔，
              // 免得后台进程没起来时每条连接都被这些请求占着。
              const schedule = () => {
                const delay = snapshot.error === undefined ? 180_000 : 600_000
                timer = setTimeout(() => {
                  void load().finally(schedule)
                }, delay)
              }
              schedule()
            }
            return () => {
              listeners.delete(listener)
              if (listeners.size === 0 && timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
              }
            }
          },
          refresh: load,
          dispose: () => {
            if (timer !== undefined) clearTimeout(timer)
            timer = undefined
            listeners.clear()
          },
        }
      }

      /** 统一的额度读数：百分比、重置日、余额都在这里排版，两个入口共用。 */
      function quotaReading(t, snapshot) {
        const summary = snapshot?.summary
        // 登录票过期是独立状态：额度数字全是 CLI 登录票换来的，票没了就没有读数。
        // 模型调用不受影响（走 API Key），所以文案只说"额度"，别说得吓人。
        if (summary?.authenticated === false) {
          return { available: false, expired: true, label: t('quota.expired'), pct: undefined, summary }
        }
        const pct = typeof summary?.remainingPct === 'number' ? summary.remainingPct : undefined
        if (snapshot?.read === true && summary === undefined) {
          return {
            available: false,
            expired: false,
            label: snapshot.error === undefined ? t('quota.unknown') : t('quota.failed'),
            pct: undefined,
            summary,
          }
        }
        if (pct === undefined) {
          return { available: false, expired: false, label: t('quota.loading'), pct: undefined, summary }
        }
        return { available: true, expired: false, label: t('quota.label'), pct, summary }
      }

      /**
       * 额度浮层的开合状态。
       *
       * 按钮在侧栏 footer 里，面板必须挂到 frame 级的 shell.overlay 上：侧栏有
       * overflow 裁剪，absolute 定位的面板贴着按钮画会被切掉一半（这正是之前
       * 面板「嵌进侧栏」的原因）。两块分别渲染，用一个外部 store 共享开合与锚点。
       */
      function createPopoverStore() {
        let snapshot = { open: false, anchor: undefined, renewToken: 0 }
        const listeners = new Set()
        const publish = (next) => {
          snapshot = next
          for (const listener of [...listeners]) listener()
        }
        return {
          getSnapshot: () => snapshot,
          subscribe: (listener) => {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          },
          // renewToken 只在「去续期」直接开面板时递增，面板据此自动发起登录；
          // 普通点按钮开面板不动它，免得每次看额度都弹授权页。
          set: (open, anchor, renew = false) =>
            publish({
              open,
              anchor: open === true ? anchor : undefined,
              renewToken: renew === true ? snapshot.renewToken + 1 : snapshot.renewToken,
            }),
        }
      }

      /** 把 getBoundingClientRect 的结果压成浮层要用的几个数。 */
      function anchorOf(element) {
        if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') {
          return undefined
        }
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }
      }

      function QuotaPanel({ t, snapshot, onRefresh, busy, onClose, style, panelRef, login, renewBusy, renewError, onRenew, onComplete }) {
        const summary = snapshot?.summary
        const expired = summary?.authenticated === false
        const pct = typeof summary?.remainingPct === 'number' ? summary.remainingPct : 0
        const used = typeof summary?.usedPct === 'number' ? summary.usedPct : undefined
        const row = (label, value) =>
          h('div', { className: 'qw-quota-row', key: label }, h('span', null, label), h('span', null, value))

        return h(
          'div',
          {
            className: 'qw-quota-panel',
            role: 'dialog',
            'aria-label': t('quota.panelTitle'),
            style,
            ref: panelRef,
          },
          h(
            'div',
            { className: 'qw-quota-head' },
            h('span', { className: 'qw-quota-title' }, t('quota.panelTitle')),
            h('button', { className: 'qw-btn', type: 'button', onClick: onClose }, t('common.close')),
          ),
          expired
            ? h(
                'div',
                null,
                h('p', { className: 'qw-err', style: { margin: '4px 0' } }, t('quota.expiredNote')),
                // 续期就是重新走一遍 CLI 的设备登录：先向宿主发起 auth login，
                // 拿到授权链接后新开一个标签页，用户授权完再回来点「完成登录」。
                // 设置页里那套登录 UI 与此同源，但设置页不是 URL 路由（它是个
                // modal），插件拿不到打开它的公开入口，所以这里自己做完整流程。
                login?.url === undefined
                  ? h(
                      'button',
                      {
                        className: 'qw-quota-renew',
                        type: 'button',
                        onClick: onRenew,
                        disabled: renewBusy === true,
                      },
                      renewBusy === true ? t('quota.renewOpening') : t('quota.renew'),
                    )
                  : h(
                      'div',
                      null,
                      h('p', { className: 'qw-hint', style: { margin: '4px 0' } }, t('quota.renewOpened')),
                      h(
                        'div',
                        { className: 'qw-quota-actions' },
                        h(
                          'a',
                          { className: 'qw-btn', href: login.url, target: '_blank', rel: 'noreferrer' },
                          t('quota.openAuth'),
                        ),
                        h(
                          'button',
                          {
                            className: 'qw-btn qw-btn-primary',
                            type: 'button',
                            onClick: onComplete,
                            disabled: renewBusy === true,
                          },
                          renewBusy === true ? t('common.refreshing') : t('quota.completeLogin'),
                        ),
                      ),
                    ),
                renewError === undefined
                  ? null
                  : h('p', { className: 'qw-err' }, `${t('quota.renewFailed')}：${renewError}`),
              )
            : null,
          row(t('plan.name'), summary?.planName ?? '—'),
          h(
            'div',
            { className: 'qw-quota-row' },
            h('span', null, t('plan.remaining')),
            h('span', null, `${(Math.round(pct * 100) / 100).toFixed(2)}%`),
          ),
          h('div', { className: 'qw-quota-bar' }, h('i', { style: { width: `${Math.min(100, Math.max(0, pct))}%` } })),
          used === undefined
            ? null
            : row(t('plan.usedLabel'), `${(Math.round(used * 100) / 100).toFixed(2)}%`),
          row(t('plan.reset'), summary?.resetTime === undefined ? '—' : formatDate(summary.resetTime)),
          summary?.remainingDays === undefined ? null : row(t('plan.daysLeft'), String(summary.remainingDays)),
          row(t('plan.balancePayg'), `${summary?.balance ?? '—'} ${summary?.currency ?? ''}`.trim()),
          h('p', { className: 'qw-hint', style: { margin: 0 } }, t('plan.balanceNote')),
          summary?.refreshedAt === undefined
            ? null
            : h(
                'p',
                { className: 'qw-hint', style: { margin: 0 } },
                t('quota.updatedAt', { time: formatClock(summary.refreshedAt) }),
              ),
          snapshot?.error === undefined
            ? null
            : h('p', { className: 'qw-err' }, `${t('error.prefix')}${snapshot.error}`),
          h('p', { className: 'qw-hint', style: { margin: 0 } }, t('quota.settingsHint')),
          h(
            'div',
            { className: 'qw-quota-actions' },
            h(
              'button',
              { className: 'qw-btn qw-btn-primary', type: 'button', onClick: onRefresh, disabled: busy === true },
              busy === true ? t('common.refreshing') : t('common.refresh'),
            ),
          ),
        )
      }

      /** 侧边栏左下角、设置按钮旁边的那一条额度。 */
      /**
       * 侧栏这一格挂在 shell 的 footer 里，父级重渲染很频繁（隔壁还有别的插件的
       * 计时器与动画）。读数只在 store 发布新快照或侧栏展开态变化时才需要重画，
       * 用 memo 挡住其余重渲染，避免额度条跟着一起闪。
       */
      const QuotaBadge = React.memo(
        function QuotaBadge({ t, store, popover, wide }) {
          const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
          const pop = React.useSyncExternalStore(popover.subscribe, popover.getSnapshot)
          const rootRef = React.useRef(null)
          const reading = quotaReading(t, snapshot)
          const digits = reading.pct === undefined ? undefined : Math.round(reading.pct * 10) / 10
          const updatedAt =
            reading.summary?.refreshedAt === undefined
              ? undefined
              : t('quota.updatedAt', { time: formatClock(reading.summary.refreshedAt) })

          const onToggle = () => {
            // 每次开都重新量一遍：侧栏会折叠、窗口会缩放，缓存旧锚点会飘。
            const rect = anchorOf(rootRef.current)
            popover.set(pop.open !== true, rect)
          }

          const title = reading.available
            ? `${t('quota.panelTitle')} · ${reading.summary?.planName ?? '—'} · ${t('plan.remaining')} ${digits}%${updatedAt === undefined ? '' : ` · ${updatedAt}`}`
            : `${t('quota.panelTitle')} · ${reading.label}`

          return h(
            'div',
            { className: 'qw-quota', ref: rootRef, 'data-quota-anchor': 'true' },
            h(
              'button',
              {
                className: 'qw-quota-btn',
                type: 'button',
                title,
                'aria-expanded': pop.open === true,
                'data-open': pop.open === true || undefined,
                'data-expired': reading.expired === true || undefined,
                onClick: onToggle,
              },
              h('span', { className: 'qw-quota-icon' }, h(QianwenIcon, { size: 15 })),
              wide === false
                ? null
                : h(
                    'span',
                    { className: 'qw-quota-line' },
                    reading.expired
                      ? t('quota.expired')
                      : reading.available
                        ? `${t('quota.short')} ${digits}%`
                        : reading.label,
                  ),
            ),
            // 过期时给一个直达续期入口：面板一开就把授权链接领回来，省一次点击。
            reading.expired && wide !== false
              ? h(
                  'a',
                  {
                    className: 'qw-quota-renew',
                    href: '#',
                    onClick: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      popover.set(true, anchorOf(rootRef.current), true)
                    },
                  },
                  t('quota.renew'),
                )
              : null,
          )
        },
        (prev, next) =>
          prev.t === next.t && prev.store === next.store && prev.popover === next.popover && prev.wide === next.wide,
      )

      /**
       * 面板本体，挂在 frame 级的 shell.overlay 上。
       *
       * 位置按按钮的 rect 现算：优先往上展开（像弹出菜单），上方不够就往下，
       * 左右夹在视口内。滚动或缩放就关掉——锚点一移动，固定定位的浮层就会
       * 浮在半空中，不如收起。
       */
      function QuotaPanelHost({ t, store, popover }) {
        const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const pop = React.useSyncExternalStore(popover.subscribe, popover.getSnapshot)
        const [busy, setBusy] = React.useState(false)
        const [login, setLogin] = React.useState(undefined)
        const [renewBusy, setRenewBusy] = React.useState(false)
        const [renewError, setRenewError] = React.useState(undefined)
        const panelRef = React.useRef(null)
        const renewSeen = React.useRef(0)
        const open = pop.open === true

        // 续期=重新走一遍 CLI 的设备登录（与设置页里的账号卡同一套宿主路由）。
        // 授权链接由 CLI 现生成，必须点一次才有；所以这里先取链接再开新标签页。
        const startRenew = async () => {
          setRenewBusy(true)
          setRenewError(undefined)
          try {
            const result = await request('/login/init', { method: 'POST' })
            if (result?.ok !== true) {
              const message = String(result?.error?.message ?? '')
              setRenewError(message === '' ? undefined : message)
              return
            }
            // 票还在有效期内时 CLI 不给链接，只回「还有效」：刷新读数即可，不是错误。
            if (result.alreadyAuthenticated === true) {
              await store.refresh()
              return
            }
            setLogin(result.login)
            const url = result.login?.url
            if (typeof url === 'string' && url !== '') {
              // 弹窗拦截时用户还能点面板里那个真链接，这里失败不影响流程。
              if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
            } else {
              const message = String(result.login?.message ?? '')
              setRenewError(message === '' ? undefined : message)
            }
          } catch (cause) {
            setRenewError(String(cause?.message ?? cause))
          } finally {
            setRenewBusy(false)
          }
        }

        const completeLogin = async () => {
          setRenewBusy(true)
          setRenewError(undefined)
          try {
            // 宿主把 CLI 的 `--complete` 放到后台跑，这条请求立刻返回（202），
            // 结果只能靠轮询 /summary 等登录票落地，与设置页轮询 /status 同理。
            const result = await request('/login/complete', { method: 'POST' })
            if (result?.ok !== true) {
              const message = String(result?.error?.message ?? '')
              setRenewError(message === '' ? undefined : message)
              return
            }
            for (let attempt = 0; attempt < 30; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              await store.refresh()
              if (store.getSnapshot()?.summary?.authenticated !== false) break
            }
            setLogin(undefined)
          } catch (cause) {
            setRenewError(String(cause?.message ?? cause))
          } finally {
            setRenewBusy(false)
          }
        }

        React.useEffect(() => {
          if (!open) return undefined
          const close = () => popover.set(false)
          const onPointerDown = (event) => {
            const panel = panelRef.current
            if (panel !== null && event.target instanceof Node && panel.contains(event.target)) return
            // 点按钮本身不算「点外面」：pointerdown 先关、click 再开，会变成永远关不掉。
            if (event.target instanceof Element && event.target.closest('[data-quota-anchor]') !== null) return
            // 「重新登录」链接自己处理点击：pointerdown 若先关了面板，click 就丢了。
            if (event.target instanceof Element && event.target.closest('a') !== null) return
            close()
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') close()
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown, true)
          // 面板是 fixed 定位，只有窗口级滚动会让锚点离开原位。这里必须用不带 capture
          // 的监听：scroll 不冒泡，capture 会把聊天流、侧栏内部的滚动也收进来，
          // 面板一打开就被自动滚动关掉。
          const onScroll = () => close()
          const onResize = () => close()
          window.addEventListener('scroll', onScroll)
          window.addEventListener('resize', onResize)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('scroll', onScroll)
            window.removeEventListener('resize', onResize)
          }
        }, [open])

        // 侧栏那枚「去续期」直接开面板时会带一个 renewToken：消费一次就够，
        // 之后开关面板不该再自动发起登录（token 用 ref 记账，关掉再开不重放）。
        React.useEffect(() => {
          if (!open) return
          if (pop.renewToken === renewSeen.current) return
          renewSeen.current = pop.renewToken
          void startRenew()
        }, [open, pop.renewToken])

        if (!open) return null

        const onRefresh = async () => {
          setBusy(true)
          try {
            await store.refresh()
          } finally {
            setBusy(false)
          }
        }

        const anchor = pop.anchor
        const width = 250
        const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
        const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
        const left = Math.min(Math.max(8, anchor?.left ?? 8), Math.max(8, viewportWidth - width - 8))
        // 上方留 240px 就往上开，否则往下；两种都夹在视口里。
        const above = anchor === undefined ? undefined : anchor.top >= 260
        const style =
          above === true
            ? { left, bottom: Math.max(8, viewportHeight - (anchor?.top ?? viewportHeight) + 8) }
            : { left, top: Math.min(Math.max(8, (anchor?.bottom ?? 0) + 8), Math.max(8, viewportHeight - 120)) }

        return h(QuotaPanel, {
          t,
          snapshot,
          onRefresh,
          busy,
          onClose: () => popover.set(false),
          style,
          panelRef,
          login,
          renewBusy,
          renewError,
          onRenew: startRenew,
          onComplete: completeLogin,
        })
      }

      const quotaStore = createQuotaStore()
      const quotaPopover = createPopoverStore()
      ctx.effect(() => () => quotaStore.dispose(), 'dsh-qianwen: quota polling')

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'dsh-qianwen-quota',
            order: 90,
            label: () => t('quota.short'),
            locale: namespace,
            inject: () => ({ t }),
          },
          (props) => h(QuotaBadge, { ...props, store: quotaStore, popover: quotaPopover }),
        ),
      )

      // 面板独立挂在 frame 层：侧栏的 overflow 裁不到它，也不会被工作区列表压住。
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-qianwen-quota-panel',
            locale: namespace,
            inject: () => ({ t }),
          },
          (props) => h(QuotaPanelHost, { ...props, store: quotaStore, popover: quotaPopover }),
        ),
      )

      /* ---- 设置 → 模型 里的说明条 ------------------------------------- */

      // 宿主按行的 settings namespace 派发这张卡上的扩展位。千问两条路由由这个
      // 插件注册，它们的 settingsNs 就是本插件的配置段名（`dsh-qianwen`）。
      const PROVIDER_NAMESPACE = 'dsh-qianwen'
      const MANAGED_ROUTES = new Set(FALLBACK_ROUTES.map((route) => route.key))

      /**
       * 挂在模型页 provider 卡片上的归属说明。
       *
       * 路由由插件注册、`settingsPath` 为空，宿主因此不给删除按钮；这一页能
       * 做的只有填 Key。说明条把这件事讲清楚，免得有人以为这里是配置入口。
       */
      function ProviderCardNote({ t, provider }) {
        if (MANAGED_ROUTES.has(provider?.provider) !== true) return null
        return h(
          'p',
          { className: 'qw-managed' },
          h('span', { className: 'qw-managed-icon' }, h(QianwenIcon, { size: 13 })),
          h('span', null, t('models.cardOwned')),
        )
      }

      ctx.slots.inject('settings.models.provider-card', () =>
        ctx.slots.register(
          {
            name: 'settings.models.provider-card',
            key: PROVIDER_NAMESPACE,
            locale: namespace,
            inject: () => ({ t }),
          },
          (props) => h(ProviderCardNote, props),
        ),
      )

      ctx.slots.inject('settings.section', () => {
        const disposers = []
        disposers.push(
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-qianwen',
              order: 36,
              label: () => t('nav.label'),
              locale: namespace,
              inject: () => ({ t }),
            },
            Page,
          ),
        )
        const iconInject = ctx.slots.inject('settings.section.icon', () => {
          const disposer = ctx.slots.register(
            { name: 'settings.section.icon', id: 'dsh-qianwen', locale: namespace },
            (props) => h(QianwenIcon, props),
          )
          return () => disposer()
        })
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {}
          }
          try {
            iconInject()
          } catch {}
        }
      })
    }

    return { name: 'dsh-qianwen', inject, apply }
  },
})