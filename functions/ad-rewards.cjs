'use strict';
const crypto = require('node:crypto');
const { loadedTransaction } = require('./loaded-transaction.cjs');
const { validateAccounting } = require('./accounting-guard.cjs');
const units = { android: 'ca-app-pub-9142692584360532/6281740760', ios: 'ca-app-pub-9142692584360532/2408365354' };
let keys, keysAt = 0;
function parseSignedQuery(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Invalid callback');
  const match = /^(.*)&signature=([^&]+)&key_id=(\d+)$/.exec(raw);
  if (!match) throw new Error('Invalid signature fields');
  const params = new URLSearchParams(raw);
  if ([...params.keys()].some((k, i, all) => all.indexOf(k) !== i)) throw new Error('Duplicate fields');
  return { content: match[1], signature: Buffer.from(decodeURIComponent(match[2]), 'base64url'), keyId: match[3], params };
}
function verifySignature(parsed, key) {
  if (key && crypto.verify('sha256', Buffer.from(parsed.content), key, parsed.signature)) return;
  // AdMob's console checker signs percent-decoded text (e.g. Crédito).
  // Permit that representation ONLY for the wallet-free connection probe.
  if (key && isVerificationProbe(parsed.params) && crypto.verify('sha256', Buffer.from(decodeURIComponent(parsed.content)), key, parsed.signature)) return;
  throw new Error('Invalid signature');
}
async function googleKeys() {
  if (keys && Date.now() - keysAt < 3600000) return keys;
  const response = await fetch('https://www.gstatic.com/admob/reward/verifier-keys.json', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Key service unavailable');
  const data = await response.json();
  keys = Object.fromEntries(data.keys.map(k => [String(k.keyId), k.pem])); keysAt = Date.now();
  return keys;
}
function isVerificationProbe(p) {
  return p.get('user_id') === 'truco-ssv-check' && p.get('custom_data') === 'verify-connection-only';
}
// All checks and the grant run in one root transaction, including deletion's
// tombstone. Signed retries return success without issuing a second credit.
function applyReward(root, p, now) {
  const id = p.get('custom_data'), uid = p.get('user_id'), tx = p.get('transaction_id');
  if (!/^[a-f0-9]{48}$/.test(id || '') || !tx || tx.length > 256) throw new Error('Invalid reward');
  const session = root?.creditEconomy?.adRewards?.[id];
  if (!session || session.uid !== uid) throw new Error('Unknown reward');
  const unit = units[session.platform];
  if (![unit, unit?.split('/')[1]].includes(p.get('ad_unit')) || p.get('reward_amount') !== '1') throw new Error('Unexpected reward');
  const transactionKey = crypto.createHash('sha256').update(tx).digest('hex');
  if (session.transactionKey === transactionKey && session.creditedAt) return root;
  if (session.creditedAt || root?.creditEconomy?.adTransactions?.[transactionKey]) throw new Error('Reused reward');
  const timestamp = Number(p.get('timestamp'));
  if (!Number.isSafeInteger(timestamp) || timestamp < session.createdAt - 300000 || timestamp > session.expiresAt || timestamp > now + 300000) throw new Error('Expired reward');
  if (root?.rewardedAds?.liveEnabled !== true || root?.userAccess?.[uid]?.blocked === true || !root?.profiles?.[uid]?.name) throw new Error('Account unavailable');
  const wallet = root.creditEconomy.wallets?.[uid];
  if (!wallet || !Number.isSafeInteger(wallet.balance) || wallet.balance < 0) throw new Error('Missing wallet');
  const next = structuredClone(root);
  next.creditEconomy.wallets[uid].balance += 1;
  Object.assign(next.creditEconomy.adRewards[id], { creditedAt: now, transactionKey });
  next.creditEconomy.adTransactions ??= {};
  next.creditEconomy.adTransactions[transactionKey] = id;
  validateAccounting(root.creditEconomy, next.creditEconomy);
  return next;
}
function createRewardFunctions({ db, identity, rateLimit, options }) {
  const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
  return {
    creditPrepareAdReward: onCall(options, async request => {
      const { uid } = await identity(request);
      const { platform, test } = request.data || {};
      if (!units[platform] || typeof test !== 'boolean') throw new HttpsError('invalid-argument', 'Plataforma inválida.');
      await rateLimit(uid, 5, 'rewardedAds');
      if (test) {
        const wallet = (await db.ref('creditEconomy/wallets/' + uid).get()).val();
        if (!wallet || wallet.balance !== 0 || wallet.locked !== 0) throw new HttpsError('failed-precondition', 'El anuncio está disponible cuando no tenés créditos ni una partida reservada.');
        return { test: true };
      }
      const now = Date.now(), id = crypto.randomBytes(24).toString('hex');
      const result = await loadedTransaction(db.ref(), root => {
        const wallet = root?.creditEconomy?.wallets?.[uid];
        if (root?.rewardedAds?.liveEnabled !== true || root?.userAccess?.[uid]?.blocked === true || !root?.profiles?.[uid]?.name || !wallet || wallet.balance !== 0 || wallet.locked !== 0) return undefined;
        // Prevent parallel devices creating several rewards while broke.
        if (Object.values(root.creditEconomy.adRewards || {}).some(s => s.uid === uid && !s.creditedAt && s.expiresAt > now)) return undefined;
        const next = structuredClone(root); next.creditEconomy.adRewards ??= {};
        next.creditEconomy.adRewards[id] = { uid, platform, createdAt: now, expiresAt: now + 600000 };
        return next;
      });
      if (!result.committed) throw new HttpsError('failed-precondition', 'Los anuncios no están habilitados o ya tenés una recompensa en curso.');
      return { id };
    }),
    creditAdRewardStatus: onCall(options, async request => {
      const { uid } = await identity(request), id = request.data?.id;
      if (!/^[a-f0-9]{48}$/.test(id || '')) throw new HttpsError('invalid-argument', 'Recompensa inválida.');
      await rateLimit(uid, 60, 'rewardStatus');
      const session = (await db.ref('creditEconomy/adRewards/' + id).get()).val();
      if (!session || session.uid !== uid) throw new HttpsError('not-found', 'Recompensa no encontrada.');
      return { credited: !!session.creditedAt };
    }),
    admobReward: onRequest(options, async (req, res) => {
      if (req.method !== 'GET') { res.status(405).send('GET required'); return; }
      let parsed;
      try { parsed = parseSignedQuery(req.originalUrl.split('?')[1]); }
      catch { res.status(400).send('Invalid callback'); return; }
      try {
        const publicKeys = await googleKeys();
        if (!publicKeys[parsed.keyId]) { keysAt = 0; await googleKeys(); }
        verifySignature(parsed, keys[parsed.keyId]);
      } catch (error) {
        res.status(error.message === 'Invalid signature' ? 403 : 503).send('Verification failed'); return;
      }
      // The AdMob console can check connectivity without a gameplay session.
      // This branch still requires Google's signature and never reads/writes a wallet.
      if (isVerificationProbe(parsed.params)) { res.status(200).send('Verified connection; no credit granted'); return; }
      let failure;
      try {
        const now = Date.now();
        const result = await loadedTransaction(db.ref(), root => {
          failure = null;
          try { return applyReward(root, parsed.params, now); }
          catch (error) { failure = error; return undefined; }
        });
        res.status(result.committed ? 200 : 400).send(result.committed ? 'OK' : 'Reward rejected');
      } catch { res.status(503).send('Retry later'); }
    }),
  };
}
module.exports = { createRewardFunctions, parseSignedQuery, verifySignature, applyReward, isVerificationProbe };
