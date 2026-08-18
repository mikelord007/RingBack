# Ringback

Ringback is a [Claude Code](https://claude.com/claude-code) plugin that phones you when a session is stuck waiting for your input.

Claude Code sessions can sit blocked on a permission prompt, or go idle waiting for your next message, for a long time when you've stepped away from your terminal. Ringback watches for that and, if you don't come back in time, places a phone call so you don't lose the wait. If you're already back and typing, it cancels the call before it ever goes out.

## Why

When you're not staring at the terminal, a blocked Claude Code session is silent — you find out only when you happen to check back. Ringback closes that gap with a phone call, using Twilio or any webhook-compatible voice provider.

## 60-second quickstart

```
claude plugin marketplace add mikelord007/RingBack
claude plugin install ringback@ringback-marketplace
```

When you enable the plugin, Claude Code prompts you for each `userConfig` field defined in `.claude-plugin/plugin.json` — there's no manual JSON editing required:

| Field | Purpose | Default |
|---|---|---|
| `phone_number` | Your number, E.164 format (e.g. `+919876543210`) | required |
| `provider` | `twilio` or `webhook` | `twilio` |
| `delay_seconds` | How long a prompt sits unanswered before you get a call | `180` |
| `cooldown_minutes` | Minimum gap between calls for the same session | `30` |
| `max_calls_per_day` | Cap on calls per day, across all sessions | `5` |
| `quiet_hours` | No calls during this local-time window, e.g. `23:00-07:00`; empty disables it | `""` |
| `events` | Comma-separated notification types that trigger a call | `permission_prompt,idle_prompt,agent_needs_input` |
| `twilio_account_sid` | Twilio Account SID (sensitive; required if `provider=twilio`) | — |
| `twilio_auth_token` | Twilio Auth Token (sensitive; required if `provider=twilio`) | — |
| `twilio_from_number` | Your Twilio number, E.164 format (required if `provider=twilio`) | — |
| `webhook_url` | Webhook endpoint (sensitive; required if `provider=webhook`) | — |

### Twilio trial-account setup

1. Sign up at [twilio.com](https://www.twilio.com) and claim a free trial number.
2. On the Twilio Console dashboard, copy your **Account SID** and **Auth Token** into `twilio_account_sid` / `twilio_auth_token`. Put the trial number itself into `twilio_from_number`.
3. Trial accounts can only call numbers you've **verified** in the Twilio console. Verify your own `phone_number` there first ([Verified Caller IDs](https://www.twilio.com/docs/voice/quickstart#verify-a-phone-number-you-own)) — calls to unverified numbers will fail.

## How it works

```
Notification (permission_prompt | idle_prompt | agent_needs_input)
        |
        v
  schedule-call.mjs
        |
        |-- event not in configured `events`?  -> exit
        |-- pending file already exists?       -> exit
        |-- guard check fails (quiet hours /
        |   cooldown / daily cap)?             -> exit
        v
  write pending/<session_id>.json
        |
        v
  sleep(delay_seconds)
        |
        v
  pending file still there? -----> no --> exit (call was cancelled)
        |
       yes
        |
        v
  guard re-check (quiet hours / cooldown / daily cap)
        |
        |-- fails --> delete pending file, exit
        v
  provider.placeCall(payload, config)   [twilio or webhook]
        |
        v
  append result to call-ledger.jsonl, delete pending file


UserPromptSubmit  ---\
Stop               ---+--> cancel-call.mjs --> delete pending/<session_id>.json
SessionEnd         ---/                        (+ prune stale pending files >24h old)
```

`schedule-call.mjs` runs as an async `Notification` hook. It writes a small JSON "pending" file under `${CLAUDE_PLUGIN_DATA}/pending/<session_id>.json`, sleeps for `delay_seconds`, then checks whether that file is still there. If you've since submitted a prompt, or the session stopped/ended, `cancel-call.mjs` will have deleted it and no call is placed. If it's still there, the anti-spam guard runs again (state can have changed during the sleep) and, if it still passes, the configured provider places the call.

One caveat, taken directly from a code comment in `cancel-call.mjs`: `Stop` fires when Claude finishes a turn, which can coincide with the moment an `idle_prompt` notification schedules a call for that same session. If `Stop` deleted the pending file unconditionally, an `idle_prompt` call would never survive long enough to fire. So `Stop` only cancels pending calls scheduled for *other* reasons (e.g. a `permission_prompt` you then answered, which ends the turn); pending `idle_prompt` calls are left in place for `UserPromptSubmit` or `SessionEnd` — genuine activity — to cancel instead. This behavior is a best-effort inference about hook ordering and may need adjustment if real-world hook timing differs.

## Anti-spam model

Every call goes through four gates, in order: **delay before calling** (a prompt has to sit unanswered for `delay_seconds` before anything happens — most prompts get answered well before that), **per-session cooldown** (`cooldown_minutes` — the same session won't call you again too soon), **global daily cap** (`max_calls_per_day` — an upper bound across every session, so a bad afternoon can't turn into a dozen calls), and **quiet hours** (`quiet_hours` — no calls at all during a configured window, checked both when the call is scheduled and again right before it's placed). The goal is a plugin that never silently blocks you and never spams you: it only calls when you're plausibly away, and it backs off aggressively once it's called.

## Webhook provider

Setting `provider` to `webhook` posts the call payload as JSON to `webhook_url` instead of calling Twilio directly. This lets any voice provider — Vapi, Bland, Telnyx, a self-hosted service, an n8n workflow — be wired in with zero code changes to the plugin.

### Request

- `POST` to your configured `webhook_url`
- `Content-Type: application/json`
- `X-Ringback-Event: call` header
- 10 second timeout (the request is aborted and treated as a failure if your endpoint doesn't respond in time)
- Non-2xx responses are treated as failures and logged (response body is truncated to 500 characters in the log)

### Payload

```json
{
  "to": "+919876543210",
  "projectName": "my-app",
  "cwd": "/home/user/projects/my-app",
  "sessionId": "a1b2c3d4-...",
  "notificationType": "permission_prompt",
  "message": "Claude wants to run a shell command that writes to disk",
  "timestamp": "2026-08-18T14:32:07.123Z"
}
```

Field notes:
- `to` — your configured `phone_number`.
- `projectName` — `path.basename()` of the session's working directory.
- `cwd` — the session's working directory.
- `sessionId` — the Claude Code session ID.
- `notificationType` — the event that triggered the call (`permission_prompt`, `idle_prompt`, or `agent_needs_input`).
- `message` — the notification message, capped at 300 characters.
- `timestamp` — ISO 8601, set at the moment the call is placed (after the delay and the final guard check, not when the notification originally fired).

### Example: wiring the webhook to a voice-agent provider

This is an illustrative sketch, not a real integration — swap `voiceApi.startCall` for your provider's actual SDK/API call.

```js
// example-server.js — minimal Express handler
import express from 'express';

const app = express();
app.use(express.json());

app.post('/ringback', async (req, res) => {
  if (req.header('X-Ringback-Event') !== 'call') {
    return res.status(400).send('unexpected event');
  }

  const { to, projectName, message, notificationType } = req.body;

  // Replace with your voice provider's actual API call.
  await voiceApi.startCall({
    to,
    script: `Claude Code needs your attention in ${projectName}. ` +
            `Reason: ${message}. Open the Claude app to respond.`,
    metadata: { notificationType },
  });

  res.status(200).json({ ok: true });
});

app.listen(3000);
```

## Regional note

Outbound voice calling is subject to carrier and regulatory constraints that vary by country. In India specifically, DLT/TRAI registration requirements can block or restrict calls placed through generic voice providers to Indian numbers. Before relying on Ringback, confirm your chosen provider (Twilio or otherwise) actually supports calling your number's country — or use the `webhook` provider to route calls through a local, compliant voice provider instead.

## Troubleshooting

- **Hook not firing at all**: run Claude Code with `claude --debug` and check that the `Notification`, `UserPromptSubmit`, `Stop`, and `SessionEnd` hooks from `hooks/hooks.json` show up as registered.
- **Check the log**: Ringback writes to `${CLAUDE_PLUGIN_DATA}/ringback.log`. The log rotates to `ringback.log.1` once it exceeds 1 MB (the previous rotation, if any, is overwritten).
- **Scripts must be executable**: `scripts/schedule-call.mjs` and `scripts/cancel-call.mjs` need the executable bit set (`chmod +x scripts/schedule-call.mjs scripts/cancel-call.mjs`) on Unix-like systems.
- **Changed `hooks.json`?**: hook wiring is loaded once per session. After editing `hooks/hooks.json`, run `/reload-plugins` in an active session for the change to take effect — restarting the CLI also works.
- **Call never arrives**: check `ringback.log` for `schedule: skip ...` (event not in `events`, already pending) or `schedule: aborted ...` (quiet hours, cooldown, or daily cap) entries, and for `schedule: call FAILED ...` with the provider error.

## Privacy & security

- `twilio_account_sid`, `twilio_auth_token`, and `webhook_url` are declared `sensitive` in `plugin.json`'s `userConfig`, which stores them via Claude Code's OS keychain mechanism rather than writing them to disk in plaintext as part of this plugin.
- The log file (`ringback.log`) never writes provider credentials, and provider error bodies are truncated (to 500 characters) before being included in log/error messages — full phone numbers are not logged in those error bodies.
- The notification `message` included in the call payload is capped at 300 characters, both when scheduling the call and again by each provider before it's sent.
- There is no telemetry. The only outbound network calls this plugin makes are to the provider you configure — the Twilio API, or your own `webhook_url`.

## Contributing / extension point

Adding a new first-class voice provider requires exactly three changes:

1. A new file in `scripts/lib/providers/` exporting a default object with an `async placeCall(payload, config)` method, following the shape of `scripts/lib/providers/twilio.mjs` and `scripts/lib/providers/webhook.mjs`.
2. One line added to the registry in `scripts/lib/providers/index.mjs` (`const PROVIDERS = { twilio, webhook, yourProvider }`).
3. Any new `userConfig` keys your provider needs, added to `.claude-plugin/plugin.json` (mark credentials `sensitive: true`).

### Non-goals for v0.1

- No two-way voice response — the call is one-way and simply directs you to the Claude mobile app / Remote Control to respond.
- No SMS/WhatsApp fallback.
- No bundled MCP server, skill, or agent — Ringback is hooks and scripts only.

## License

MIT — see [LICENSE](./LICENSE).
