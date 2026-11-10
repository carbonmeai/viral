// Hides API keys in text that may reach a stage error, a log or the app: the values given, header values that
// carry keys (Authorization, x-api-key, x-goog-api-key, xi-api-key), `key=` URL parameters, and strings shaped like
// the services' keys (sk-…, xai-…, AIza…, vck_…). Errors from SDKs and services can echo a request back.
const KEY_SHAPES: ReadonlyArray<RegExp> = [
  /\b(authorization|x-api-key|x-goog-api-key|xi-api-key)(["']?\s*[:=]\s*["']?)(bearer\s+)?[^\s"',;}]+/gi,
  /\b(bearer)(\s+)()[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:key|api_key|apikey)=)()()[^&\s"']+/gi
]
const TOKEN_SHAPES: ReadonlyArray<RegExp> = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bxai-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bvck_[A-Za-z0-9_-]{8,}/g
]

export const REDACTED = "[redacted]"

export const redactSecrets = (text: string, known: ReadonlyArray<string> = []): string => {
  let out = text
  for (const value of known) {
    const key = value.trim()
    if (key.length >= 6) out = out.split(key).join(REDACTED)
  }
  for (const shape of KEY_SHAPES) out = out.replace(shape, (_, name: string, sep: string, bearer: string | undefined) => `${name}${sep}${bearer ?? ""}${REDACTED}`)
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, REDACTED)
  return out
}
