import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024
const LEDGER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function logPath(config) {
  return path.join(config.dataDir, 'ringback.log')
}

function pendingDir(config) {
  return path.join(config.dataDir, 'pending')
}

function ledgerPath(config) {
  return path.join(config.dataDir, 'call-ledger.jsonl')
}

export function log(config, message) {
  try {
    ensureDir(config.dataDir)
    const file = logPath(config)
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_LOG_BYTES) {
        fs.copyFileSync(file, file + '.1')
        fs.writeFileSync(file, '')
      }
    } catch {
      // file doesn't exist yet, nothing to rotate
    }
    const line = `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(file, line)
  } catch {
    // logging must never throw into the caller
  }
}

export function getPendingPath(config, sessionId) {
  return path.join(pendingDir(config), `${sessionId}.json`)
}

export function writePending(config, sessionId, data) {
  ensureDir(pendingDir(config))
  fs.writeFileSync(getPendingPath(config, sessionId), JSON.stringify(data))
}

export function readPending(config, sessionId) {
  try {
    const raw = fs.readFileSync(getPendingPath(config, sessionId), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function pendingExists(config, sessionId) {
  return fs.existsSync(getPendingPath(config, sessionId))
}

export function deletePending(config, sessionId) {
  try {
    fs.unlinkSync(getPendingPath(config, sessionId))
    return true
  } catch {
    return false
  }
}

export function cleanStalePending(config, maxAgeMs = 24 * 60 * 60 * 1000) {
  const dir = pendingDir(config)
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  const now = Date.now()
  for (const entry of entries) {
    const full = path.join(dir, entry)
    try {
      const stat = fs.statSync(full)
      if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(full)
    } catch {
      // ignore races against other hook processes touching the same file
    }
  }
}

export function readLedger(config) {
  let raw
  try {
    raw = fs.readFileSync(ledgerPath(config), 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // ignore malformed lines
    }
  }
  return entries
}

export function appendLedger(config, entry) {
  ensureDir(config.dataDir)
  const existing = readLedger(config)
  const cutoff = Date.now() - LEDGER_MAX_AGE_MS
  const pruned = existing.filter((e) => typeof e.ts === 'number' && e.ts >= cutoff)
  pruned.push(entry)
  const body = pruned.map((e) => JSON.stringify(e)).join('\n') + '\n'
  fs.writeFileSync(ledgerPath(config), body)
}
