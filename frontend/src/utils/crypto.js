/**
 * CrowdPulse Crypto — browser-side signing
 *
 * CRITICAL: The hash payload field order here must be IDENTICAL to
 * core/transaction.js Transaction.hash() in the SAYMAN chain.
 * Field order in JSON.stringify matters for deterministic hashing.
 *
 * Chain's hash() serialises:
 *   { id, sender, recipient, amount, nonce, data, timestamp, type, gasLimit, gasPrice }
 */

import Elliptic from 'elliptic';
const EC = Elliptic.ec;
const ec = new EC('secp256k1');

// ─── SHA-256 via Web Crypto API ───────────────────────────────────────────────
async function sha256Hex(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Address derivation — mirrors wallet/wallet.js exactly ───────────────────
// address = sha256(publicKey).slice(0, 40)
export async function deriveAddress(publicKey) {
  const hash = await sha256Hex(publicKey);
  return hash.slice(0, 40);
}

// ─── Generate a fresh wallet ──────────────────────────────────────────────────
export async function generateWallet() {
  const keyPair    = ec.genKeyPair();
  const privateKey = keyPair.getPrivate('hex');
  const publicKey  = keyPair.getPublic('hex');
  const address    = await deriveAddress(publicKey);
  return { privateKey, publicKey, address };
}

// ─── Restore wallet from private key ─────────────────────────────────────────
export async function importWallet(privateKey) {
  if (!privateKey || privateKey.length < 60) throw new Error('Invalid private key');
  const keyPair  = ec.keyFromPrivate(privateKey.trim(), 'hex');
  const publicKey = keyPair.getPublic('hex');
  const address   = await deriveAddress(publicKey);
  return { privateKey: privateKey.trim(), publicKey, address };
}

// ─── Build an unsigned CONTRACT_CALL transaction ──────────────────────────────
// Matches Transaction constructor in core/transaction.js (Phase 9)
export function buildTx({ sender, contractAddress, method, args, nonce, gasLimit = 200000, gasPrice = 1 }) {
  // UUID-style id using Web Crypto
  const id = crypto.randomUUID();
  return {
    id,
    type:      'CONTRACT_CALL',
    sender,
    recipient: contractAddress,
    amount:    0,
    nonce,
    gasLimit,
    gasPrice,
    // data must be { method, args } — matches chain's CONTRACT_CALL handler
    data:      { method, args },
    timestamp: Date.now(),
    signature: null,
  };
}

// ─── Hash a transaction — EXACT field order from transaction.js hash() ────────
async function hashTx(tx) {
  // DO NOT change field order — must match chain exactly
  const payload = JSON.stringify({
    id:        tx.id,
    sender:    tx.sender,
    recipient: tx.recipient,
    amount:    tx.amount,
    nonce:     tx.nonce,
    data:      tx.data,
    timestamp: tx.timestamp,
    type:      tx.type,
    gasLimit:  tx.gasLimit,
    gasPrice:  tx.gasPrice,
  });
  return sha256Hex(payload);
}

// ─── Sign a transaction ───────────────────────────────────────────────────────
// Returns { r, s } — matches Wallet.sign() in wallet/wallet.js
export async function signTransaction(tx, privateKey) {
  const keyPair = ec.keyFromPrivate(privateKey.trim(), 'hex');
  const hash    = await hashTx(tx);
  const sig     = keyPair.sign(hash);
  return {
    r: sig.r.toString('hex'),
    s: sig.s.toString('hex'),
  };
}