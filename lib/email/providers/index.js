// Email provider registry.
//
// The email service asks `getProviders()` for an ordered list of adapters and
// sends through the first one. Today that is Resend only. Adding Brevo,
// Mailjet, Amazon SES or Postmark later means writing one adapter module with
// a `send()` method and registering it here — authentication, verification and
// notification code never change.

import { resendAdapter } from './resend';
// Future adapters (implement the same { name, send } shape):
// import { brevoAdapter } from './brevo';
// import { mailjetAdapter } from './mailjet';
// import { sesAdapter } from './ses';
// import { postmarkAdapter } from './postmark';

const REGISTRY = {
  resend: resendAdapter,
  // brevo: brevoAdapter,
  // mailjet: mailjetAdapter,
  // ses: sesAdapter,
  // postmark: postmarkAdapter,
};

/**
 * Ordered provider chain. `EMAIL_PROVIDER` selects the primary adapter
 * (default: resend). `EMAIL_PROVIDER_FALLBACK` may name a second adapter to
 * try when the primary fails with a transient error. Leave fallback empty in
 * production until a second provider is actually configured — automatic
 * failover to an unconfigured provider only adds noise.
 */
export function getProviders() {
  const primaryName = (process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  const fallbackName = (process.env.EMAIL_PROVIDER_FALLBACK || '').trim().toLowerCase();

  const chain = [];
  const primary = REGISTRY[primaryName];
  if (primary) chain.push(primary);
  else if (primaryName !== 'resend') chain.push(resendAdapter);

  if (fallbackName && REGISTRY[fallbackName] && fallbackName !== primaryName) {
    chain.push(REGISTRY[fallbackName]);
  }
  return chain;
}

export function primaryProviderName() {
  return getProviders()[0]?.name || 'none';
}
