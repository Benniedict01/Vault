// Central email service.
//
// Application code calls the typed functions below — never a provider SDK
// directly. The service resolves configuration, renders templates, sends via
// the provider chain, and records an EmailEvent for observability. Provider
// errors are converted to EmailError with stable codes; raw provider payloads
// are never returned to users and never logged with secrets.

import { db } from '../prisma';
import { EmailError, EMAIL_ERROR_CODES, userMessage, isEmailError } from './errors';
import { getProviders, primaryProviderName } from './providers';
import { redactRecipient } from './providers/resend';
import {
  verificationEmail,
  passwordResetEmail,
  welcomeEmail,
  walletActivityEmail,
  securityNotificationEmail,
} from './templates';

/** Structured server log — diagnostics only, never secrets or full addresses. */
function logFailure(type, error, extra = {}) {
  console.error('[email] send failed', {
    type,
    provider: extra.provider || primaryProviderName(),
    recipient: extra.recipient ? redactRecipient(extra.recipient) : '<redacted>',
    error_code: error instanceof EmailError ? error.code : 'UNKNOWN_EMAIL_ERROR',
    provider_status: error instanceof EmailError ? error.providerStatus : undefined,
    message: error?.message ? String(error.message).slice(0, 300) : undefined,
    ...extra.meta,
  });
}

function appBase() {
  const base = (process.env.APP_URL || '').trim();
  if (!base) {
    throw new EmailError(
      EMAIL_ERROR_CODES.EMAIL_NOT_CONFIGURED,
      'APP_URL is not configured. Set it to the deployed Crypto Vault URL.'
    );
  }
  return base.replace(/\/+$/, '');
}

async function recordEmailEvent({ userId, type, provider, status, providerMessageId, failureCode, failureMessage }) {
  try {
    await db.emailEvent.create({
      data: {
        userId: userId || null,
        type,
        provider,
        status,
        providerMessageId: providerMessageId || null,
        failureCode: failureCode || null,
        failureMessage: failureMessage ? failureMessage.slice(0, 500) : null,
      },
    });
  } catch (err) {
    // Observability must never break the product flow.
    console.error('[email] failed to record EmailEvent', { type, status, message: err?.message });
  }
}

/**
 * Send one message through the provider chain.
 * Resolves with { messageId } on acceptance; throws EmailError otherwise.
 */
export async function sendEmail({ to, subject, text, html, type = 'generic', userId = null }) {
  const from = (process.env.EMAIL_FROM || '').trim();
  if (!from) {
    const err = new EmailError(EMAIL_ERROR_CODES.EMAIL_NOT_CONFIGURED, 'EMAIL_FROM is not set.');
    logFailure(type, err, { recipient: to });
    await recordEmailEvent({ userId, type, provider: 'none', status: 'failed', failureCode: err.code, failureMessage: err.message });
    throw err;
  }

  const providers = getProviders();
  if (!providers.length) {
    const err = new EmailError(EMAIL_ERROR_CODES.EMAIL_NOT_CONFIGURED, 'No email provider adapter is registered.');
    logFailure(type, err, { recipient: to });
    await recordEmailEvent({ userId, type, provider: 'none', status: 'failed', failureCode: err.code, failureMessage: err.message });
    throw err;
  }

  let lastError = null;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const isLast = i === providers.length - 1;
    // Only fall through to the next provider for transient failures.
    try {
      const { messageId } = await provider.send({ to, from, subject, text, html });
      await recordEmailEvent({
        userId, type, provider: provider.name, status: 'sent', providerMessageId: messageId,
      });
      return { messageId, provider: provider.name };
    } catch (err) {
      lastError = err;
      const code = err instanceof EmailError ? err.code : EMAIL_ERROR_CODES.UNKNOWN_EMAIL_ERROR;
      const transient = [
        EMAIL_ERROR_CODES.EMAIL_PROVIDER_TIMEOUT,
        EMAIL_ERROR_CODES.NETWORK_ERROR,
        EMAIL_ERROR_CODES.EMAIL_PROVIDER_ERROR,
        EMAIL_ERROR_CODES.RATE_LIMITED,
      ].includes(code);
      if (!isLast && transient) {
        logFailure(type, err, { recipient: to, provider: provider.name, meta: { note: 'trying fallback provider' } });
        continue;
      }
      logFailure(type, err, { recipient: to, provider: provider.name });
      await recordEmailEvent({
        userId, type, provider: provider.name, status: 'failed',
        providerMessageId: null, failureCode: code,
        failureMessage: err?.message ? String(err.message).slice(0, 500) : 'unknown',
      });
      throw err instanceof EmailError
        ? err
        : new EmailError(EMAIL_ERROR_CODES.UNKNOWN_EMAIL_ERROR, String(err?.message || err), { cause: err, providerName: provider.name });
    }
  }
  throw lastError || new EmailError(EMAIL_ERROR_CODES.UNKNOWN_EMAIL_ERROR, 'No provider attempted');
}

// ── Typed transactional messages ────────────────────────────────────────────

export async function sendVerificationEmail(user, token) {
  const url = `${appBase()}/verify-email?token=${encodeURIComponent(token)}`;
  const { subject, text, html } = verificationEmail({ url });
  return sendEmail({ to: user.email, subject, text, html, type: 'verification', userId: user.id });
}

export async function sendPasswordResetEmail(user, token) {
  const url = `${appBase()}/reset-password?token=${encodeURIComponent(token)}`;
  const { subject, text, html } = passwordResetEmail({ url });
  return sendEmail({ to: user.email, subject, text, html, type: 'password-reset', userId: user.id });
}

export async function sendWelcomeEmail(user) {
  const { subject, text, html } = welcomeEmail({ dashboardUrl: `${appBase()}/dashboard` });
  return sendEmail({ to: user.email, subject, text, html, type: 'welcome', userId: user.id });
}

/**
 * Deposit/withdrawal notification — always to the wallet owner's account
 * email, never a shared admin address.
 */
export async function sendWalletDepositNotification(user, details) {
  const {
    walletLabel, chainName, address,
    action = 'deposit', amount, symbol,
    usdValue = null, txHash = null,
  } = details;
  const usdText = usdValue == null ? null : `$${Number(usdValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const { subject, text, html } = walletActivityEmail({
    walletLabel, chainName, address, action,
    amount: String(amount), symbol, usdText, txHash,
  });
  return sendEmail({ to: user.email, subject, text, html, type: `wallet-${action}`, userId: user.id });
}

export async function sendSecurityNotification(user, { heading, bodyText }) {
  const { subject, text, html } = securityNotificationEmail({ heading, bodyText });
  return sendEmail({ to: user.email, subject, text, html, type: 'security', userId: user.id });
}

/**
 * Resend throttling: has this user been sent a `type` email in the last
 * `cooldownMs`? Used to keep verification resends from being abused.
 */
export async function wasRecentlySent(userId, type, cooldownMs = 60_000) {
  const recent = await db.emailEvent.findFirst({
    where: {
      userId,
      type,
      status: 'sent',
      createdAt: { gt: new Date(Date.now() - cooldownMs) },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

export { userMessage, isEmailError, EmailError, EMAIL_ERROR_CODES };
