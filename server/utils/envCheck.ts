/**
 * Startup configuration check.
 *
 * The OAuth half of this app is invisible from the UI — every page renders and every in-portal
 * action works whether or not a single portal ever registered — so a misconfiguration produces a
 * system that looks completely healthy and quietly registers nobody. These checks turn that into a
 * line in the log at boot.
 *
 * Pure and env-injected so the rules are unit-testable.
 */

export interface EnvReport {
  /** Effective configuration, one line, safe to log (no secret values). */
  summary: string
  /** Problems that will stop portals from registering. */
  errors: string[]
  /** Things that work but are probably not what was intended. */
  warnings: string[]
}

/**
 * Values people paste in when a variable "looks required".
 *
 * B24_APPLICATION_TOKEN is the dangerous one: it is an OPTIONAL extra gate, and when it holds
 * anything other than the portal's real token every first install is rejected with 403 — while the
 * boot line and /api/health still report oauth and encryption ready. A placeholder here is the one
 * misconfiguration that looks exactly like a healthy system.
 */
const PLACEHOLDER = /^(x{2,}|placeholder|changeme|todo|your[_-]?\w*|insert[_-]?\w*|<.*>|‹.*›|\.\.\.)$/i

export function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim())
}

export interface EnvCheckInput {
  dbEnabled: boolean
  encryptionReady: boolean
  edgeSecurity: boolean
  tombstoneDays: number
  env: Record<string, string | undefined>
}

export function checkAppEnv(input: EnvCheckInput): EnvReport {
  const { env } = input
  const oauthReady = Boolean(env.B24_CLIENT_ID && env.B24_CLIENT_SECRET)
  const keepAlive = input.dbEnabled && oauthReady && input.encryptionReady
  const errors: string[] = []
  const warnings: string[] = []

  const appToken = (env.B24_APPLICATION_TOKEN ?? '').trim()
  if (appToken && looksLikePlaceholder(appToken)) {
    errors.push(
      'B24_APPLICATION_TOKEN looks like a placeholder. It is OPTIONAL — leave it unset. '
      + 'With a wrong value every first install is rejected with 403 while everything else reports healthy.'
    )
  }

  if (input.dbEnabled && !oauthReady) {
    errors.push('B24_CLIENT_ID/SECRET are not set — the install webhook will REFUSE every registration')
  }
  if (input.dbEnabled && oauthReady && !input.encryptionReady) {
    errors.push('B24_TOKEN_ENC_KEY is missing or not 32 bytes — the install webhook will REFUSE every registration')
  }
  if (!input.dbEnabled) {
    warnings.push('DATABASE_URL is not set — portals cannot register and the rating prompt stays off')
  }

  const summary = `db=${input.dbEnabled ? 'on' : 'off'} oauth=${oauthReady ? 'ready' : 'MISSING'} `
    + `encryption=${input.encryptionReady ? 'ready' : 'MISSING'} keepalive=${keepAlive ? 'on' : 'off'} `
    + `edgeSecurity=${input.edgeSecurity ? 'on' : 'off'} tombstoneTtlDays=${input.tombstoneDays}`

  return { summary, errors, warnings }
}
