#!/usr/bin/env node
import { getDataDir } from './lib/config.mjs'
import { log, readPending, deletePending, cleanStalePending } from './lib/state.mjs'

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

async function main() {
  const raw = await readStdin()
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const sessionId = input.session_id
  const hookEvent = input.hook_event_name
  if (!sessionId) process.exit(0)

  const dataDir = getDataDir()
  if (!dataDir) process.exit(0)
  const config = { dataDir }

  const pending = readPending(config, sessionId)
  if (pending) {
    // Stop fires when Claude finishes a turn, which can coincide with the moment an
    // idle_prompt Notification schedules a call for the same session. If Stop deleted
    // that pending file unconditionally, an idle-prompt call would never survive long
    // enough to fire. So Stop only cancels pending calls scheduled for OTHER reasons
    // (e.g. a permission_prompt the user then answered, ending the turn); idle_prompt
    // pending calls are left for UserPromptSubmit/SessionEnd (real activity) to cancel.
    // This should be verified empirically against real hook ordering (see README
    // troubleshooting / spec §8) and adjusted if observed behavior differs.
    if (hookEvent === 'Stop' && pending.notificationType === 'idle_prompt') {
      log(config, `cancel: skip session=${sessionId} (Stop received but pending call is idle_prompt)`)
    } else {
      deletePending(config, sessionId)
      log(config, `cancel: cancelled session=${sessionId} trigger=${hookEvent}`)
    }
  }

  if (hookEvent === 'SessionEnd') {
    cleanStalePending(config)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
