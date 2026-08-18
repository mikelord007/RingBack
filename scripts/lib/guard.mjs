const QUIET_HOURS_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

function parseHHMM(str) {
  const [h, m] = str.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function isQuietHours(quietHoursStr, now) {
  if (!quietHoursStr) return false;
  if (!QUIET_HOURS_RE.test(quietHoursStr)) return false;

  const [startStr, endStr] = quietHoursStr.split('-');
  const start = parseHHMM(startStr);
  const end = parseHHMM(endStr);
  if (start === null || end === null) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (start <= end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  // window crosses midnight (e.g. 23:00-07:00): quiet if after start OR before end
  return nowMinutes >= start || nowMinutes < end;
}

export function shouldCall(config, ledger, now, sessionId) {
  if (isQuietHours(config.quietHours, now)) {
    return { ok: false, reason: 'quiet_hours' };
  }

  const nowMs = now.getTime();
  const cooldownMs = config.cooldownMinutes * 60_000;

  let lastSessionCallMs = -Infinity;
  let dailyCount = 0;

  for (const entry of ledger) {
    if (!entry || entry.ok !== true || typeof entry.ts !== 'number') continue;

    if (entry.sessionId === sessionId && entry.ts > lastSessionCallMs) {
      lastSessionCallMs = entry.ts;
    }

    if (nowMs - entry.ts < 24 * 60 * 60_000) {
      dailyCount++;
    }
  }

  if (lastSessionCallMs !== -Infinity && nowMs - lastSessionCallMs < cooldownMs) {
    return { ok: false, reason: 'cooldown' };
  }

  if (dailyCount >= config.maxCallsPerDay) {
    return { ok: false, reason: 'daily_cap' };
  }

  return { ok: true };
}
