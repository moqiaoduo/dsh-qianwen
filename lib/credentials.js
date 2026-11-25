/**
 * 把 API Key 写进 DSH 凭证存储（`.credentials.yaml` 的 `refs:` 段）。
 *
 * pi-ai 解析 provider 的 `apiKeyEnv` 时走 `ctx.credentials.resolve()`
 * （`dsh-llm-pi-ai/src/auth.ts` 的 `authContextFrom`），所以这里写入的值
 * 对下一次模型调用立即生效，不需要重启插件或 dsh。
 *
 * `CredentialRef` 只是一个 branded string，运行时就是环境变量名本身；这里
 * 不 import `@deepseek-ai/dsh-credentials`（工作区插件解析不到裸包名），
 * 自己按该包的 `REF_PATTERN` 做同样的校验。
 */

/** 与 `@deepseek-ai/dsh-credentials` 的 `REF_PATTERN` 保持一致。 */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 是否是合法的凭证引用名（POSIX shell 标识符）。 */
export function isValidRefName(name) {
  return typeof name === 'string' && REF_PATTERN.test(name)
}

function credentialsOf(ctx) {
  const credentials = ctx.get?.('credentials')
  if (credentials === undefined) {
    throw new Error('this composition mounts no credentials service (dsh-credentials-local)')
  }
  return credentials
}

/**
 * 读取一条凭证的配置状态（不含明文）。
 * @param ctx - 携带可选 `credentials` 服务的插件上下文。
 * @param name - 环境变量名，例如 `DASHSCOPE_API_KEY`。
 * @returns `{configured, source, writable, masked}`；服务缺失时 `{configured:false, reason}`。
 */
export async function describeKey(ctx, name) {
  if (!isValidRefName(name)) return { configured: false, reason: 'invalid-name' }
  const credentials = ctx.get?.('credentials')
  if (credentials === undefined) return { configured: false, reason: 'no-credentials-service' }
  const info = await credentials.describe(name)
  return {
    configured: info.configured === true,
    source: info.source,
    writable: info.writable === true,
    masked: info.masked,
  }
}

/**
 * 写入一条凭证。
 * @param ctx - 携带 `credentials` 服务的插件上下文。
 * @param name - 环境变量名。
 * @param value - 非空密钥明文；空值会被拒绝（要清除请用 {@link clearKey}）。
 */
export async function writeKey(ctx, name, value) {
  if (!isValidRefName(name)) {
    throw new Error(`credential ref "${String(name)}" must match ${String(REF_PATTERN)}`)
  }
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed === '') throw new Error('API key is empty')
  await credentialsOf(ctx).set(name, trimmed)
  return { configured: true }
}

/** 删除一条凭证；删除不存在的条目是 no-op。 */
export async function clearKey(ctx, name) {
  if (!isValidRefName(name)) {
    throw new Error(`credential ref "${String(name)}" must match ${String(REF_PATTERN)}`)
  }
  await credentialsOf(ctx).unset(name)
  return { configured: false }
}
