import twilio from './twilio.mjs';
import webhook from './webhook.mjs';

const PROVIDERS = { twilio, webhook };

export function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}
