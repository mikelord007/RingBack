import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietHours, shouldCall } from '../scripts/lib/guard.mjs';

const QUIET = '23:00-07:00';
const NORMAL = '13:00-14:00';

function dateAt(h, m) {
  return new Date(2026, 0, 1, h, m, 0, 0);
}

test('isQuietHours: midnight-crossing window, late part', () => {
  assert.equal(isQuietHours(QUIET, dateAt(23, 30)), true);
});

test('isQuietHours: midnight-crossing window, early part', () => {
  assert.equal(isQuietHours(QUIET, dateAt(3, 0)), true);
});

test('isQuietHours: midnight-crossing window, outside', () => {
  assert.equal(isQuietHours(QUIET, dateAt(12, 0)), false);
});

test('isQuietHours: non-crossing window, inside', () => {
  assert.equal(isQuietHours(NORMAL, dateAt(13, 30)), true);
});

test('isQuietHours: non-crossing window, outside', () => {
  assert.equal(isQuietHours(NORMAL, dateAt(15, 0)), false);
});

test('isQuietHours: empty string disables', () => {
  assert.equal(isQuietHours('', dateAt(23, 30)), false);
  assert.equal(isQuietHours(undefined, dateAt(23, 30)), false);
});

test('isQuietHours: malformed string does not throw, returns false', () => {
  assert.doesNotThrow(() => isQuietHours('not-a-time', dateAt(12, 0)));
  assert.equal(isQuietHours('not-a-time', dateAt(12, 0)), false);
  assert.equal(isQuietHours('25:00-07:00', dateAt(12, 0)), false);
});

const baseConfig = { quietHours: '', cooldownMinutes: 30, maxCallsPerDay: 3 };

test('shouldCall: empty ledger allows call', () => {
  const now = dateAt(12, 0);
  assert.deepEqual(shouldCall(baseConfig, [], now, 's1'), { ok: true });
});

test('shouldCall: quiet hours blocks even with empty ledger', () => {
  const config = { ...baseConfig, quietHours: QUIET };
  const now = dateAt(23, 30);
  assert.deepEqual(shouldCall(config, [], now, 's1'), { ok: false, reason: 'quiet_hours' });
});

test('shouldCall: cooldown blocks recent same-session call', () => {
  const now = dateAt(12, 30);
  const ledger = [
    { ts: now.getTime() - 10 * 60_000, sessionId: 's1', provider: 'twilio', ok: true },
  ];
  assert.deepEqual(shouldCall(baseConfig, ledger, now, 's1'), { ok: false, reason: 'cooldown' });
});

test('shouldCall: cooldown expired does not block', () => {
  const now = dateAt(12, 30);
  const ledger = [
    { ts: now.getTime() - 31 * 60_000, sessionId: 's1', provider: 'twilio', ok: true },
  ];
  assert.deepEqual(shouldCall(baseConfig, ledger, now, 's1'), { ok: true });
});

test('shouldCall: cooldown is per-session', () => {
  const now = dateAt(12, 30);
  const ledger = [
    { ts: now.getTime() - 5 * 60_000, sessionId: 's2', provider: 'twilio', ok: true },
  ];
  assert.deepEqual(shouldCall(baseConfig, ledger, now, 's1'), { ok: true });
});

test('shouldCall: daily cap blocks when max reached in last 24h', () => {
  const now = dateAt(12, 0);
  const config = { ...baseConfig, cooldownMinutes: 0, maxCallsPerDay: 2 };
  const ledger = [
    { ts: now.getTime() - 20 * 60 * 60_000, sessionId: 'a', provider: 'twilio', ok: true },
    { ts: now.getTime() - 10 * 60 * 60_000, sessionId: 'b', provider: 'twilio', ok: true },
  ];
  assert.deepEqual(shouldCall(config, ledger, now, 's1'), { ok: false, reason: 'daily_cap' });
});

test('shouldCall: calls older than 24h do not count toward daily cap', () => {
  const now = dateAt(12, 0);
  const config = { ...baseConfig, cooldownMinutes: 0, maxCallsPerDay: 2 };
  const ledger = [
    { ts: now.getTime() - 25 * 60 * 60_000, sessionId: 'a', provider: 'twilio', ok: true },
    { ts: now.getTime() - 26 * 60 * 60_000, sessionId: 'b', provider: 'twilio', ok: true },
  ];
  assert.deepEqual(shouldCall(config, ledger, now, 's1'), { ok: true });
});

test('shouldCall: ok:false entries do not count toward cooldown', () => {
  const now = dateAt(12, 30);
  const ledger = [
    { ts: now.getTime() - 5 * 60_000, sessionId: 's1', provider: 'twilio', ok: false },
  ];
  assert.deepEqual(shouldCall(baseConfig, ledger, now, 's1'), { ok: true });
});

test('shouldCall: ok:false entries do not count toward daily cap', () => {
  const now = dateAt(12, 0);
  const config = { ...baseConfig, cooldownMinutes: 0, maxCallsPerDay: 1 };
  const ledger = [
    { ts: now.getTime() - 1 * 60 * 60_000, sessionId: 'a', provider: 'twilio', ok: false },
    { ts: now.getTime() - 2 * 60 * 60_000, sessionId: 'b', provider: 'twilio', ok: false },
  ];
  assert.deepEqual(shouldCall(config, ledger, now, 's1'), { ok: true });
});

test('shouldCall: quiet_hours reason wins over cooldown/daily_cap', () => {
  const now = dateAt(23, 30);
  const config = { quietHours: QUIET, cooldownMinutes: 30, maxCallsPerDay: 1 };
  const ledger = [
    { ts: now.getTime() - 5 * 60_000, sessionId: 's1', provider: 'twilio', ok: true },
  ];
  // both cooldown and daily_cap would independently block here too
  assert.deepEqual(shouldCall(config, ledger, now, 's1'), { ok: false, reason: 'quiet_hours' });
});
