function escapeXml(str) {
  // '&' must be escaped first, otherwise it would double-escape the
  // ampersands introduced by the other replacements below.
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default {
  async placeCall(payload, config) {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      throw new Error('Twilio provider: missing twilio_account_sid/twilio_auth_token/twilio_from_number config');
    }

    const message = escapeXml(payload.message.slice(0, 300));
    const twiml = `<Response><Say>Claude Code needs your attention in project ${escapeXml(payload.projectName)}. Reason: ${message}. Open the Claude app to respond.</Say></Response>`;

    const body = new URLSearchParams({
      To: payload.to,
      From: config.twilioFromNumber,
      Twiml: twiml,
    });

    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Twilio call failed: ${response.status} ${bodyText.slice(0, 500)}`);
    }

    const json = await response.json();
    return { ok: true, sid: json.sid ?? null, status: response.status };
  },
};
