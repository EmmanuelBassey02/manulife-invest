'use strict';
const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');
const { HttpError, now } = require('../lib/util');
const E = require('../lib/engine');
const S = require('../lib/services');

/**
 * Generic crypto-payment provider webhook.
 * Configure your provider (e.g. NOWPayments, CoinPayments, Coinbase Commerce via an adapter) to POST:
 *   { "payment_ref": "TX-1931", "status": "confirmed" | "failed", "tx_hash": "...", "confirmations": 12, "amount": 10000 }
 * with header  X-Signature: hex(HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, raw request body)).
 * Private keys never touch this application — only public receiving addresses are stored.
 */
function register(r) {
  r.post('/api/webhooks/payments', async (ctx) => {
    if (!config.PAYMENT_WEBHOOK_SECRET) throw new HttpError(503, 'Webhook secret is not configured.');
    const sig = String(ctx.req.headers['x-signature'] || '');
    const expected = crypto.createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(ctx.rawBody || Buffer.alloc(0)).digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      await S.audit(ctx, 'webhook.bad_signature', 'payment', null);
      throw new HttpError(401, 'Invalid signature.');
    }
    const body = ctx.body || {};
    const p = await db.get('SELECT * FROM payments WHERE ref=?', [String(body.payment_ref || '')]);
    if (!p) throw new HttpError(404, 'Unknown payment reference.');
    if (body.confirmations != null) {
      await db.run('UPDATE payments SET confirmations=?, updated_at=? WHERE id=?', [Math.max(0, parseInt(body.confirmations, 10) || 0), now(), p.id]);
    }
    if (!['awaiting', 'submitted'].includes(p.status)) return { ok: true, ignored: 'already processed' };
    const settings = await S.getSetting('payments');
    if (body.status === 'confirmed') {
      if (Number(body.amount) + 1e-9 < Number(p.amount_crypto) * 0.995) {
        await db.run("UPDATE payments SET status='submitted', note=?, tx_hash=COALESCE(?, tx_hash), updated_at=? WHERE id=?", [`Underpaid: received ${body.amount} ${p.currency}`, body.tx_hash || null, now(), p.id]);
        await S.notifyAdmins(`Underpayment on ${p.ref}`, `Received ${body.amount} of ${p.amount_crypto} ${p.currency}. Manual review needed.`, '/admin/payments');
        return { ok: true, review: true };
      }
      if ((parseInt(body.confirmations, 10) || 0) < settings.required_confirmations) return { ok: true, waiting: true };
      await E.confirmPayment(p, { txHash: body.tx_hash, confirmations: parseInt(body.confirmations, 10) || 0, note: 'Confirmed by payment provider', ctx });
      return { ok: true };
    }
    if (body.status === 'failed') {
      await E.rejectPayment(p, { note: 'Payment provider reported the payment as failed', ctx });
      return { ok: true };
    }
    return { ok: true, ignored: 'status' };
  });
}

module.exports = { register };
