export default {
  async placeCall(payload, config) {
    if (!config.webhookUrl) {
      throw new Error('Webhook provider: missing webhook_url config');
    }

    const body = JSON.stringify({ ...payload, message: payload.message.slice(0, 300) });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let response;
    try {
      response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ringback-Event': 'call',
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Webhook call timed out after 10s');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Webhook call failed: ${response.status} ${bodyText.slice(0, 500)}`);
    }

    return { ok: true, status: response.status };
  },
};
