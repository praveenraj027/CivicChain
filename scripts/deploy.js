import 'dotenv/config';
import fs      from 'fs';
import path    from 'path';
import crypto  from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require  = createRequire(import.meta.url);
const elliptic = require('elliptic');
const ec       = new elliptic.ec('secp256k1');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NETWORKS = {
  local:   'http://localhost:10000',
  testnet: 'https://sayman.onrender.com',
  mainnet: 'https://mainnet.sayman.io'
};

const argv    = process.argv.slice(2);
const netIdx  = argv.indexOf('--network');
const network = netIdx !== -1 ? argv[netIdx + 1] : 'local';
const RPC_URL = process.env.SAYMAN_RPC_URL || NETWORKS[network];

if (!RPC_URL) {
  console.error(`❌ Unknown network: "${network}". Use: local | testnet | mainnet`);
  process.exit(1);
}

const DEFAULT_KEY = crypto.createHash('sha256').update('crowdpulse-dev-deployer-2024').digest('hex');
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || DEFAULT_KEY;

let keyPair, publicKey, address;
try {
  keyPair   = ec.keyFromPrivate(PRIVATE_KEY);
  publicKey = keyPair.getPublic('hex');
  address   = crypto.createHash('sha256').update(publicKey).digest('hex').substring(0, 40);
} catch (err) {
  console.error('❌ Invalid DEPLOYER_PRIVATE_KEY:', err.message);
  process.exit(1);
}

async function rpcGet(endpoint) {
  const res  = await fetch(`${RPC_URL}${endpoint}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function rpcPost(endpoint, body) {
  const res  = await fetch(`${RPC_URL}${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function getAddressInfo() {
  try { return await rpcGet(`/api/address/${address}`); } catch {}
  try { const d = await rpcGet(`/api/balance/${address}`); return { balance: d.balance || 0, nonce: 0 }; } catch {}
  return { balance: 0, nonce: 0 };
}

async function getNonce()   { return (await getAddressInfo()).nonce   || 0; }
async function getBalance() { return (await getAddressInfo()).balance || 0; }

async function requestFaucet() {
  try { return await rpcPost('/api/faucet', { address }); }
  catch (err) { return { error: err.message }; }
}

async function waitForBlock(currentHeight, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const s = await rpcGet('/api/stats');
      if ((s.blocks || 0) > currentHeight) return s.blocks;
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

function signTx(tx) {
  const hash = crypto.createHash('sha256').update(JSON.stringify({
    type: tx.type, timestamp: tx.timestamp, data: tx.data,
    gasLimit: tx.gasLimit, gasPrice: tx.gasPrice, nonce: tx.nonce
  })).digest('hex');
  return keyPair.sign(hash).toDER('hex');
}

async function deployContract({ name, version, code, nonce }) {
  const ts = Date.now();
  const tx = {
    type:      'CONTRACT_DEPLOY',
    timestamp: ts,
    nonce,
    gasLimit:  90,
    gasPrice:  1,
    data: { from: address, name, version, abi: [], code }
  };
  tx.signature = signTx(tx);

  await rpcPost('/api/broadcast', {
    type:      tx.type,
    data:      tx.data,
    timestamp: tx.timestamp,
    signature: tx.signature,
    publicKey,
    gasLimit:  tx.gasLimit,
    gasPrice:  tx.gasPrice,
    nonce:     tx.nonce
  });

  const contractAddress = crypto.createHash('sha256')
    .update(address + ts.toString()).digest('hex').substring(0, 40);

  return contractAddress;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   CrowdPulse Contract Deployer  v1.0     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  Network  : ${network}`);
  console.log(`  RPC      : ${RPC_URL}`);
  console.log(`  Deployer : ${address}`);

  let chainHeight = 0;
  try {
    const stats = await rpcGet('/api/stats');
    chainHeight = stats.blocks || 0;
    console.log(`  Chain    : ✅ reachable (block #${chainHeight})`);
  } catch (err) {
    console.log(`  Chain    : ❌ unreachable — ${err.message}`);
    process.exit(1);
  }

  let balance = await getBalance();
  console.log(`  Balance  : ${balance} SAYM`);

  if (balance < 10) {
    process.stdout.write('  Faucet   : requesting SAYM... ');
    const r = await requestFaucet();
    if (r && !r.error) {
      await waitForBlock(chainHeight, 20000);
      chainHeight = (await rpcGet('/api/stats')).blocks || chainHeight;
      balance = await getBalance();
      console.log(`funded ✅ (balance: ${balance} SAYM)`);
    } else {
      console.log(`failed ⚠ (${r?.error || 'unknown'})`);
      console.log(`\n  Fund this address and re-run:\n  ${address}\n`);
      process.exit(1);
    }
  }

  console.log('');

  const contractsDir = path.join(__dirname, '..', 'contracts');
  const contracts = [
    { file: 'ReportRegistry.js',    name: 'ReportRegistry',    version: '1.0.0' },
    { file: 'ReputationManager.js', name: 'ReputationManager', version: '1.0.0' },
    { file: 'RewardManager.js',     name: 'RewardManager',     version: '1.0.0' }
  ];

  for (const c of contracts) {
    if (!fs.existsSync(path.join(contractsDir, c.file))) {
      console.error(`❌ Missing file: contracts/${c.file}`);
      process.exit(1);
    }
  }

  let nonce = await getNonce();
  console.log(`  Nonce    : ${nonce}`);
  console.log(`  Gas      : limit=90 price=1 (max cost 90 SAYM, actual ~9 SAYM each)`);
  console.log('');

  const deployed = {};

  for (const c of contracts) {
    const code     = fs.readFileSync(path.join(contractsDir, c.file), 'utf8');
    const codeSize = (code.length / 1024).toFixed(1);

    process.stdout.write(`  Sending   ${c.name.padEnd(22)} (${codeSize}kb) nonce=${nonce}... `);

    try {
      const contractAddress = await deployContract({
        name:    c.name,
        version: c.version,
        code,
        nonce
      });

      deployed[c.name] = contractAddress;
      nonce++;
      console.log(`✅`);
      console.log(`    Address : ${contractAddress}`);

    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  if (Object.keys(deployed).length > 0) {
    console.log('');
    process.stdout.write(`  Mining    waiting for next block... `);
    const newHeight = await waitForBlock(chainHeight, 60000);
    console.log(newHeight ? `block #${newHeight} ✅` : `timeout ⚠ (txs may still land)`);
  }

  console.log('');
  console.log('  Verifying on-chain...');
  let verified = 0;
  for (const [name, addr] of Object.entries(deployed)) {
    try {
      const c = await rpcGet(`/api/contracts/${addr}`);
      if (c && c.address) {
        console.log(`  ✅ ${name.padEnd(24)} ${addr}`);
        verified++;
      } else {
        console.log(`  ⚠ ${name.padEnd(24)} ${addr} (not found yet — may still be mining)`);
      }
    } catch {
      console.log(`  ⚠ ${name.padEnd(24)} ${addr} (verify manually)`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  Deployment Summary');
  console.log('══════════════════════════════════════════');

  if (Object.keys(deployed).length === 0) {
    console.log('  ❌ No contracts deployed.');
    console.log('');
    console.log('  Debug:');
    console.log(`  curl https://sayman.onrender.com/api/address/${address}`);
    console.log(`  curl https://sayman.onrender.com/api/contracts`);
    process.exit(1);
  }

  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`  ${name.padEnd(24)} ${addr}`);
  }

  const manifest = {
    network,
    rpcUrl:     RPC_URL,
    deployer:   address,
    deployedAt: new Date().toISOString(),
    contracts:  deployed
  };

  const manifestPath = path.join(__dirname, '..', 'deployed.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log('  📄 deployed.json saved');
  console.log('');
  console.log('  Verify live:');
  console.log(`  curl https://sayman.onrender.com/api/contracts`);
  console.log('');
  console.log('  Next:');
  console.log('  1. cd backend && node index.js');
  console.log('  2. open frontend/index.html');
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Deploy crashed:', err.message);
  process.exit(1);
});
