import Elliptic from 'elliptic';
const EC = Elliptic.ec;
const ec = new EC('secp256k1');

async function sha256Hex(str) {
  const buf  = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveAddress(publicKey) {
  return (await sha256Hex(publicKey)).slice(0, 40);
}

export async function generateWallet() {
  const kp         = ec.genKeyPair();
  const privateKey = kp.getPrivate('hex').padStart(64, '0');
  const publicKey  = kp.getPublic('hex');
  const address    = await deriveAddress(publicKey);
  return { privateKey, publicKey, address };
}

export async function importWallet(privateKey) {
  if (!privateKey || privateKey.trim().length < 60)
    throw new Error('Invalid private key — must be 64-char hex');
  const kp        = ec.keyFromPrivate(privateKey.trim(), 'hex');
  const publicKey = kp.getPublic('hex');
  const address   = await deriveAddress(publicKey);
  return { privateKey: privateKey.trim(), publicKey, address };
}

async function hashTx({ type, timestamp, data, gasLimit, gasPrice, nonce }) {
  const payload = JSON.stringify({ type, timestamp, data, gasLimit, gasPrice, nonce });
  return sha256Hex(payload);
}

export async function buildReportTx({
  wallet, nonce, category, description, location,
  severity = 'MEDIUM', evidenceHash = null,
  gasLimit = 10, gasPrice = 1,   // gasUsed=6, so 10 is safe minimum
}) {
  const type      = 'REPORT_CREATE';
  const timestamp = Date.now();
  const data = {
    from:         wallet.address,
    category:     category    || 'OTHER',
    location:     location    || {},
    severity,
    evidenceHash,
    description:  description || '',
    timestamp,
  };
  const hash = await hashTx({ type, timestamp, data, gasLimit, gasPrice, nonce });
  const kp   = ec.keyFromPrivate(wallet.privateKey, 'hex');
  const sig  = kp.sign(hash);
  return {
    type, timestamp, data,
    signature: { r: sig.r.toString('hex'), s: sig.s.toString('hex') },
    publicKey: wallet.publicKey,
    gasLimit, gasPrice, nonce,
  };
}

export async function buildContractCallTx({
  wallet, nonce, contractAddress, method, args = {},
  gasLimit = 10, gasPrice = 1,
}) {
  const type      = 'CONTRACT_CALL';
  const timestamp = Date.now();
  const data = { from: wallet.address, contractAddress, method, args };
  const hash = await hashTx({ type, timestamp, data, gasLimit, gasPrice, nonce });
  const kp   = ec.keyFromPrivate(wallet.privateKey, 'hex');
  const sig  = kp.sign(hash);
  return {
    type, timestamp, data,
    signature: { r: sig.r.toString('hex'), s: sig.s.toString('hex') },
    publicKey: wallet.publicKey,
    gasLimit, gasPrice, nonce,
  };
}