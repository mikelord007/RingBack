#!/usr/bin/env node
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import {
  log,
  writePending,
  readPending,
  pendingExists,
  deletePending,
  readLedger,
  appendLedger,
} from './lib/state.mjs'
import { shouldCall } from './lib/guard.mjs'
import { getProvider } from './lib/providers/index.mjs'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const raw = await readStdin()
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    // no config yet to log against; nothing usable to do
    process.exit(0)
  }

  const sessionId = input.session_id
  const notificationType = input.notification_type ?? input.hook_event_name
  const cwd = input.cwd ?? process.cwd()
  const message = String(input.message ?? '').slice(0, 300)

  if (!sessionId) process.exit(0)

  const loaded = loadConfig()
  if (!loaded.valid) {
    // Can't log to the configured data dir if config didn't even resolve a data dir;
    // best-effort only, never throw.
    process.exit(0)
  }
  const { config } = loaded

  if (!config.events.includes(notificationType)) {
    log(config, `schedule: skip session=${sessionId} type=${notificationType} (not in configured events)`)
    process.exit(0)
  }

  if (pendingExists(config, sessionId)) {
    log(config, `schedule: skip session=${sessionId} (call already pending)`)
    process.exit(0)
  }

  const initialGuard = shouldCall(config, readLedger(config), new Date(), sessionId)
  if (!initialGuard.ok) {
    log(config, `schedule: skip session=${sessionId} reason=${initialGuard.reason}`)
    process.exit(0)
  }

  writePending(config, sessionId, {
    createdAt: Date.now(),
    cwd,
    message,
    notificationType,
  })
  log(config, `schedule: pending call scheduled session=${sessionId} type=${notificationType} delay=${config.delaySeconds}s`)

  await sleep(config.delaySeconds * 1000)

  const pending = readPending(config, sessionId)
  if (!pending) {
    log(config, `schedule: cancelled session=${sessionId} (pending file removed before delay elapsed)`)
    process.exit(0)
  }

  const finalGuard = shouldCall(config, readLedger(config), new Date(), sessionId)
  if (!finalGuard.ok) {
    log(config, `schedule: aborted session=${sessionId} reason=${finalGuard.reason}`)
    deletePending(config, sessionId)
    process.exit(0)
  }

  const payload = {
    to: config.phoneNumber,
    projectName: path.basename(pending.cwd || cwd),
    cwd: pending.cwd || cwd,
    sessionId,
    notificationType: pending.notificationType,
    message: pending.message,
    timestamp: new Date().toISOString(),
  }

  try {
    const provider = getProvider(config.provider)
    await provider.placeCall(payload, config)
    appendLedger(config, { ts: Date.now(), sessionId, provider: config.provider, ok: true })
    log(config, `schedule: call placed session=${sessionId} provider=${config.provider} project=${payload.projectName}`)
  } catch (err) {
    appendLedger(config, { ts: Date.now(), sessionId, provider: config.provider, ok: false })
    log(config, `schedule: call FAILED session=${sessionId} provider=${config.provider} error=${err?.message ?? err}`)
  } finally {
    deletePending(config, sessionId)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
