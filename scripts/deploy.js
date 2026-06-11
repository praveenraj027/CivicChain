#!/usr/bin/env node
/**
 * CrowdPulse Contract Deployer v2.1
 *
 * Fixes vs v1:
 *  - Retry logic on broadcast (network blips on render.com)
 *  - Waits for each contract to appear in chain state before deploying next
 *  - Correct Phase 9 transaction types used
 *  - deployed.json written atomically
 *  - Supports --network local|testnet|mainnet
 */

import fs      from 'fs';
import path    from 'path';
import crypto  from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';

const require  = createRequire(import.meta.url);
const elliptic = require('elliptic');
const ec       = new elliptic.ec('secp256k1');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Network config ───────────────────────────────────────────────────────────
const NETWORKS = {
  local:   'http://localhost:10000',
  testnet: process.env.SAYMAN_RPC || 'https://sayman.onrender.com',
  mainnet: process.env.SAYMAN_MAINNET_RPC || 'https://mainnet.sayman.io',
};

const arg     = process.argv.find(a => a.startsWith('--network=') || a === '--network');
const netName = arg
  ? (arg.includes('=') ? arg.split('=')[1] : process.argv[process.argv.indexOf(arg) + 1])
  : 'testnet';

const RPC = NETWORKS[netName] || NETWORKS.testnet;

// ─── Wallet setup ─────────────────────────────────────────────────────────────
// Use DEPLOYER_PRIVATE_KEY env var or generate fresh for local dev
let deployerPrivKey = process.env.DEPLOYER_PRIVATE_KEY;
let keyPair;

if (deployerPrivKey) {
  keyPair = ec.keyFromPrivate(deployerPrivKey, 'hex');
} else {
  keyPair = ec.genKeyPair();
  deployerPrivKey = keyPair.getPrivate('hex');
  console.warn('⚠  No DEPLOYER_PRIVATE_KEY set — using ephemeral key (local dev only)');
}

const publicKey = keyPair.getPublic('hex');
const address   = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 40);

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function rpc(endpoint, method = 'GET', body = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${RPC}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (attempt === retries) throw e;
      console.log(`  ↺ retry ${attempt}/${retries}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function hashTx(tx) {
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
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function signTx(tx) {
  const hash = hashTx(tx);
  const sig  = keyPair.sign(hash);
  return { r: sig.r.toString('hex'), s: sig.s.toString('hex') };
}

async function getNonce() {
  try {
    const data = await rpc(`/api/address/${address}`);
    return data.nonce ?? 0;
  } catch { return 0; }
}

async function deploy(name, version, code) {
  const nonce = await getNonce();
  const tx = {
    id:        crypto.randomUUID(),
    type:      'CONTRACT_DEPLOY',
    sender:    address,
    recipient: null,
    amount:    0,
    nonce,
    gasLimit:  1_000_000,
    gasPrice:  1,
    data:      { name, version, code },
    timestamp: Date.now(),
    signature: null,
  };
  tx.signature = signTx(tx);

  const result = await rpc('/api/broadcast', 'POST', { transaction: tx, publicKey });

  // Poll until the contract appears in state (up to 30s)
  const contractId = result.contractAddress || result.txId || result.id;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    try {
      const contracts = await rpc('/api/contracts');
      const deployed  = (contracts.contracts || Object.values(contracts))
        .find(c => c.name === name || c.address === contractId);
      if (deployed) return deployed.address || contractId;
    } catch {}
  }
  // Return what the broadcast gave us even if poll timed out
  return contractId;
}

// ─── Contract source (loaded from contracts/ dir) ────────────────────────────
function loadContract(filename) {
  const p = path.join(__dirname, '..', 'contracts', filename);
  if (!fs.existsSync(p)) throw new Error(`Contract not found: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════╗');
console.log('║  CrowdPulse Contract Deployer  v2.1      ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`  Network  : ${netName}`);
console.log(`  RPC      : ${RPC}`);
console.log(`  Deployer : ${address}\n`);

const contracts = {};

try {
  // 1. ReportRegistry
  process.stdout.write('  Deploying ReportRegistry … ');
  contracts.ReportRegistry = await deploy('ReportRegistry', '1.0.0', loadContract('ReportRegistry.js'));
  console.log(`✓  ${contracts.ReportRegistry}`);

  // 2. ReputationManager
  process.stdout.write('  Deploying ReputationManager … ');
  contracts.ReputationManager = await deploy('ReputationManager', '1.0.0', loadContract('ReputationManager.js'));
  console.log(`✓  ${contracts.ReputationManager}`);

  // 3. RewardManager
  process.stdout.write('  Deploying RewardManager … ');
  contracts.RewardManager = await deploy('RewardManager', '1.0.0', loadContract('RewardManager.js'));
  console.log(`✓  ${contracts.RewardManager}`);

  // Write deployed.json atomically
  const manifest = {
    network:    netName,
    rpc:        RPC,
    deployer:   address,
    deployedAt: new Date().toISOString(),
    contracts,
  };

  const outPath = path.join(__dirname, '..', 'deployed.json');
  fs.writeFileSync(outPath + '.tmp', JSON.stringify(manifest, null, 2));
  fs.renameSync(outPath + '.tmp', outPath);

  console.log('\n  ✅ deployed.json written');
  console.log('\n  Contract addresses:');
  for (const [k, v] of Object.entries(contracts)) {
    console.log(`     ${k.padEnd(20)} ${v}`);
  }
  console.log('');

} catch (e) {
  console.error('\n  ❌ Deploy failed:', e.message);
  process.exit(1);
}