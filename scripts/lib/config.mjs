const OPTION_PREFIX = 'CLAUDE_PLUGIN_OPTION_'

function readOption(key) {
  const value = process.env[OPTION_PREFIX + key]
  return value === undefined || value === '' ? undefined : value
}

function parseNumber(value, fallback) {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseEvents(value) {
  const raw = value ?? 'permission_prompt,idle_prompt,agent_needs_input'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Minimal, validation-free accessor for scripts (cancel-call.mjs) that only need to
// find the data directory — they must work even when phone_number/provider credentials
// aren't configured yet, since cancelling a pending call has nothing to do with those.
export function getDataDir() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA
  return dataDir || undefined
}

// loadConfig() never throws — callers (hooks) must be able to fail silent.
export function loadConfig() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA
  const rootDir = process.env.CLAUDE_PLUGIN_ROOT

  if (!dataDir) {
    return { valid: false, error: 'CLAUDE_PLUGIN_DATA is not set' }
  }

  const provider = (readOption('PROVIDER') ?? 'twilio').trim()
  const phoneNumber = readOption('PHONE_NUMBER')

  const config = {
    dataDir,
    rootDir,
    phoneNumber,
    provider,
    delaySeconds: parseNumber(readOption('DELAY_SECONDS'), 180),
    cooldownMinutes: parseNumber(readOption('COOLDOWN_MINUTES'), 30),
    maxCallsPerDay: parseNumber(readOption('MAX_CALLS_PER_DAY'), 5),
    quietHours: readOption('QUIET_HOURS') ?? '',
    events: parseEvents(readOption('EVENTS')),
    twilioAccountSid: readOption('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: readOption('TWILIO_AUTH_TOKEN'),
    twilioFromNumber: readOption('TWILIO_FROM_NUMBER'),
    webhookUrl: readOption('WEBHOOK_URL'),
  }

  if (!phoneNumber) {
    return { valid: false, error: 'phone_number is not configured' }
  }

  if (provider !== 'twilio' && provider !== 'webhook') {
    return { valid: false, error: `unknown provider "${provider}" (expected twilio or webhook)` }
  }

  if (provider === 'twilio') {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      return {
        valid: false,
        error: 'provider=twilio requires twilio_account_sid, twilio_auth_token, and twilio_from_number',
      }
    }
  }

  if (provider === 'webhook' && !config.webhookUrl) {
    return { valid: false, error: 'provider=webhook requires webhook_url' }
  }

  return { valid: true, config }
}
