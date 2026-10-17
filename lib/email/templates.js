// Email content templates. Plain functions returning { subject, text, html }.
// Keep copy honest: Crypto Vault is watch-only and alerts can be delayed.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap({ heading, bodyHtml, ctaLabel, ctaUrl, footer }) {
  const cta = ctaLabel && ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0"><tr><td style="border-radius:12px;background:#2fd68a">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:13px 26px;font-weight:700;color:#04120b;text-decoration:none;border-radius:12px;font-family:Arial,Helvetica,sans-serif">${escapeHtml(ctaLabel)}</a>
      </td></tr></table>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:32px 20px;background:#06080c;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px" cellpadding="0" cellspacing="0">
        <tr><td style="padding:26px 30px;background:#0d1219;border:1px solid #1b2330;border-radius:18px 18px 0 0">
          <span style="font-size:18px;font-weight:700;color:#f4f7fb;letter-spacing:-.02em">Crypto<span style="color:#62f2a3">Vault</span></span>
        </td></tr>
        <tr><td style="padding:28px 30px 34px;background:#0d1219;border:1px solid #1b2330;border-top:0;border-radius:0 0 18px 18px">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#f4f7fb">${escapeHtml(heading)}</h1>
          <div style="font-size:15px;line-height:1.7;color:#a3aec0">${bodyHtml}</div>
          ${cta}
          <p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#667084">${escapeHtml(footer || 'Crypto Vault is watch-only. It never holds funds or keys.')}
          ${ctaUrl ? `<br/>If the button does not work, copy this link:<br/><span style="word-break:break-all;color:#8a95a7">${escapeHtml(ctaUrl)}</span>` : ''}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

export function verificationEmail({ url }) {
  return {
    subject: 'Verify your Crypto Vault email',
    text: `Verify your Crypto Vault email to secure your account and unlock wallet alerts.\n\n${url}\n\nThis link expires in 24 hours and can be used once. If you did not create a Crypto Vault account, you can ignore this email.`,
    html: wrap({
      heading: 'Verify your email',
      bodyHtml: `<p>Confirm this address to secure your account and unlock wallet alerts. This link expires in <strong style="color:#f4f7fb">24 hours</strong> and can be used once.</p>`,
      ctaLabel: 'Verify email',
      ctaUrl: url,
    }),
  };
}

export function passwordResetEmail({ url }) {
  return {
    subject: 'Reset your Crypto Vault password',
    text: `Reset your Crypto Vault password:\n\n${url}\n\nThis link expires in 1 hour and can be used once. If you did not request this, you can ignore this email — your password has not changed.`,
    html: wrap({
      heading: 'Reset your password',
      bodyHtml: `<p>Choose a new password for your vault. This link expires in <strong style="color:#f4f7fb">1 hour</strong> and can be used once.</p><p>If you did not request this, you can ignore this email — your password has not changed.</p>`,
      ctaLabel: 'Reset password',
      ctaUrl: url,
    }),
  };
}

export function welcomeEmail({ dashboardUrl }) {
  return {
    subject: 'Welcome to Crypto Vault',
    text: `Your email is verified and your vault is ready.\n\nAdd public wallet addresses and Crypto Vault will watch them for you.\n\n${dashboardUrl}\n\nCrypto Vault is watch-only — it never asks for seed phrases or private keys.`,
    html: wrap({
      heading: 'Your vault is ready',
      bodyHtml: `<p>Your email is verified. Add public wallet addresses and Crypto Vault will watch them for you — balances, market values and deposit alerts in one place.</p><p>Remember: Crypto Vault is watch-only. Never paste a seed phrase or private key anywhere.</p>`,
      ctaLabel: 'Open your vault',
      ctaUrl: dashboardUrl,
    }),
  };
}

export function walletActivityEmail({ walletLabel, chainName, address, action, amount, symbol, usdText, txHash }) {
  const verb = action === 'withdrawal' ? 'left' : 'arrived in';
  const subject = `${action === 'withdrawal' ? 'Withdrawal' : 'Deposit'} — ${walletLabel}`;
  const usdLine = usdText ? `Estimated value: ${usdText}\n` : 'Estimated value: unavailable at alert time\n';
  return {
    subject,
    text: `${amount} ${symbol} ${verb} ${walletLabel}.\n\nNetwork: ${chainName}\nWallet: ${address}\n${usdLine}${txHash ? `Transaction: ${txHash}\n` : ''}\nCrypto Vault is watch-only; no private key is stored.`,
    html: wrap({
      heading: action === 'withdrawal' ? `Withdrawal from ${walletLabel}` : `Deposit received in ${walletLabel}`,
      bodyHtml: `<p><strong style="color:#f4f7fb;font-size:17px">${escapeHtml(amount)} ${escapeHtml(symbol)}</strong> ${action === 'withdrawal' ? 'left' : 'arrived in'} <strong style="color:#f4f7fb">${escapeHtml(walletLabel)}</strong>.</p>
        <p style="font-size:13.5px">Network: ${escapeHtml(chainName)}<br/>Wallet: <span style="word-break:break-all">${escapeHtml(address)}</span><br/>${usdText ? `Estimated value: ${escapeHtml(usdText)}` : 'Estimated value: unavailable at alert time'}${txHash ? `<br/>Transaction: <span style="word-break:break-all">${escapeHtml(txHash)}</span>` : ''}</p>`,
    }),
  };
}

export function securityNotificationEmail({ heading, bodyText }) {
  return {
    subject: `Security alert — ${heading}`,
    text: `${bodyText}\n\nIf this was not you, reset your password immediately.\n\nCrypto Vault is watch-only; no private key is stored.`,
    html: wrap({
      heading,
      bodyHtml: `<p>${escapeHtml(bodyText)}</p><p>If this was not you, reset your password immediately.</p>`,
    }),
  };
}
