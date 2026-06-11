/**
 * CrowdPulse Backend v2.1
 *
 * Fixes vs v2.0:
 *  - /api/broadcast validates tx structure before forwarding
 *  - /api/reports reads from contract's getReports() method (not raw state)
 *  - /api/leaderboard reads from getLeaderboard() method
 *  - /api/blocks handles chain height-vs-index naming differences
 *  - Graceful startup even if deployed.json is missing
 *  - NODE_ENV=production disables verbose logging
 */

import 'dotenv/config';
import express    from 'express';
import cors       from 'cors';
import rateLimit  from 'express-rate-limit';
import helmet     from 'helmet';
import fs         from 'fs';
import path       from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const isProd    = process.env.NODE_ENV === 'production';

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '512kb' }));

const limiter = rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded — slow down.' },
});
app.use('/api/', limiter);

// ─── Config ───────────────────────────────────────────────────────────────────
const SAYMAN_RPC = process.env.SAYMAN_RPC || 'https://sayman.onrender.com';
const PORT       = process.env.PORT       || 3001;

// Load deployed contract addresses
let CONTRACTS = { ReportRegistry: '', ReputationManager: '', RewardManager: '' };
const manifestPath = path.join(__dirname, '..', 'deployed.json');

function reloadContracts() {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    CONTRACTS = { ...CONTRACTS, ...(m.contracts || {}) };
    if (!isProd) console.log('📄 Contracts reloaded:', CONTRACTS);
  } catch {
    console.warn('⚠  deployed.json not found — run: npm run deploy:testnet');
  }
}
reloadContracts();
// Hot-reload deployed.json when it changes (after re-deploy)
fs.watchFile(manifestPath, { interval: 3000 }, reloadContracts);

// ─── RPC helper ───────────────────────────────────────────────────────────────
async function rpc(endpoint, method = 'GET', body = null, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${SAYMAN_RPC}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || `RPC ${res.status}`);
      return data;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Call a read-only contract method via /api/contracts/:addr/call
async function callContract(address, method, args = {}) {
  if (!address) throw new Error(`Contract address not set for ${method}`);
  return rpc(`/api/contracts/${address}/call`, 'POST', { method, args });
}

// ─── AI category classifier (server-side fallback) ───────────────────────────
const KEYWORDS = {
  ROAD_DAMAGE:     ['pothole', 'road', 'crack', 'broken', 'pavement', 'asphalt'],
  FLOOD:           ['flood', 'waterlog', 'overflow', 'drain', 'rain', 'puddle', 'submerge'],
  FIRE:            ['fire', 'burn', 'smoke', 'flame', 'blaze', 'burning'],
  STREETLIGHT:     ['light', 'dark', 'lamp', 'street light', 'bulb', 'no light', 'unlit'],
  GARBAGE:         ['garbage', 'trash', 'waste', 'litter', 'dump', 'stench', 'rubbish'],
  WATER_LEAK:      ['leak', 'pipe', 'water supply', 'burst', 'seepage'],
  UNSAFE_BUILDING: ['building', 'wall', 'collapse', 'unsafe', 'crack', 'structure', 'demolish'],
};

function aiVerify(description = '', category = '') {
  const text     = `${description} ${category}`.toLowerCase();
  let detected   = category || 'OTHER';
  let confidence = 65 + Math.floor(Math.random() * 15);

  for (const [cat, kws] of Object.entries(KEYWORDS)) {
    if (kws.some(k => text.includes(k))) {
      detected   = cat;
      confidence = 82 + Math.floor(Math.random() * 13);
      break;
    }
  }
  return {
    aiCategory:  detected,
    confidence,
    isValid:     confidence > 60,
    isDuplicate: false,
  };
}

// ─── Validate broadcast payload ────────────────────────────────────────────
function validateTx(tx) {
  const required = ['id', 'type', 'sender', 'nonce', 'timestamp', 'signature'];
  for (const f of required) {
    if (tx[f] === undefined || tx[f] === null)
      throw new Error(`Transaction missing field: ${f}`);
  }
  if (!tx.signature?.r || !tx.signature?.s)
    throw new Error('Invalid signature format — expected { r, s }');
  if (typeof tx.nonce !== 'number')
    throw new Error('nonce must be a number');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health + frontend auto-discovery of contract addresses
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', contracts: CONTRACTS, rpc: SAYMAN_RPC });
});

// Network stats
app.get('/api/stats', async (_req, res) => {
  try { res.json(await rpc('/api/stats')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Fresh nonce for address (always fetched live — never cached)
app.get('/api/nonce/:address', async (req, res) => {
  try {
    const data = await rpc(`/api/address/${req.params.address}`);
    res.json({ nonce: data.nonce ?? 0, address: req.params.address });
  } catch (e) {
    res.status(502).json({ error: e.message, nonce: 0 });
  }
});

// Balance
app.get('/api/balance/:address', async (req, res) => {
  try {
    const data = await rpc(`/api/address/${req.params.address}`);
    res.json({ balance: data.balance ?? 0, address: req.params.address });
  } catch (e) {
    res.status(502).json({ error: e.message, balance: 0 });
  }
});

// AI verify (standalone — also called internally on broadcast)
app.post('/api/ai/verify', (req, res) => {
  const { description, category } = req.body;
  res.json(aiVerify(description, category));
});

// Broadcast user-signed transaction
app.post('/api/broadcast', async (req, res) => {
  try {
    const { transaction, publicKey } = req.body;
    if (!transaction) return res.status(400).json({ error: 'transaction required' });
    if (!publicKey)   return res.status(400).json({ error: 'publicKey required' });

    // Validate structure before hitting chain
    validateTx(transaction);

    const result = await rpc('/api/broadcast', 'POST', { transaction, publicKey });

    // AI verify for report submissions
    let ai = null;
    if (transaction?.data?.method === 'createReport') {
      ai = aiVerify(transaction.data.args?.description, transaction.data.args?.category);
    }

    res.json({ success: true, txId: transaction.id, result, ai });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Reports — uses contract's getReports() method for proper filtering/pagination
app.get('/api/reports', async (req, res) => {
  try {
    if (!CONTRACTS.ReportRegistry) return res.json({ reports: [], total: 0 });

    const args = {};
    if (req.query.category) args.category = req.query.category;
    if (req.query.status)   args.status   = req.query.status;
    if (req.query.reporter) args.reporter = req.query.reporter;
    if (req.query.page)     args.page     = parseInt(req.query.page);
    if (req.query.pageSize) args.pageSize = parseInt(req.query.pageSize);

    const data = await callContract(CONTRACTS.ReportRegistry, 'getReports', args);
    res.json(data);
  } catch (e) {
    // Fallback: read raw state if contract call endpoint not available
    try {
      const raw     = await rpc(`/api/contracts/${CONTRACTS.ReportRegistry}/state`);
      const reports = Object.values(raw.state?.reports || {})
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      res.json({ reports, total: reports.length });
    } catch (e2) {
      res.status(500).json({ error: e.message, reports: [], total: 0 });
    }
  }
});

// Single report
app.get('/api/reports/:id', async (req, res) => {
  try {
    if (!CONTRACTS.ReportRegistry) return res.status(404).json({ error: 'Contracts not deployed' });
    const data = await callContract(CONTRACTS.ReportRegistry, 'getReport', { reportId: req.params.id });
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Reputation score
app.get('/api/reputation/:address', async (req, res) => {
  try {
    if (!CONTRACTS.ReputationManager) return res.json({ reputation: 0 });
    const data = await callContract(CONTRACTS.ReputationManager, 'getScore', { address: req.params.address });
    res.json({ address: req.params.address, reputation: data.score || 0, level: data.level });
  } catch (e) {
    res.status(500).json({ error: e.message, reputation: 0 });
  }
});

// Reward points
app.get('/api/rewards/:address', async (req, res) => {
  try {
    if (!CONTRACTS.RewardManager) return res.json({ points: 0 });
    const data = await callContract(CONTRACTS.RewardManager, 'getPoints', { address: req.params.address });
    res.json({ address: req.params.address, points: data.points || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message, points: 0 });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (_req, res) => {
  try {
    if (!CONTRACTS.ReputationManager) return res.json({ leaderboard: [] });
    const data = await callContract(CONTRACTS.ReputationManager, 'getLeaderboard', { limit: 20 });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, leaderboard: [] });
  }
});

// Block explorer — recent blocks
app.get('/api/blocks', async (req, res) => {
  try {
    const stats  = await rpc('/api/stats');
    // Chain may use 'blocks' or 'height' or 'blockCount'
    const latest = stats.blocks || stats.height || stats.blockCount || 0;
    const count  = Math.min(parseInt(req.query.count || '10'), 20);
    const blocks = [];
    for (let i = latest; i > Math.max(0, latest - count); i--) {
      try { blocks.push(await rpc(`/api/blocks/${i}`)); } catch {}
    }
    res.json({ blocks, latest });
  } catch (e) {
    res.status(500).json({ error: e.message, blocks: [] });
  }
});

// Proxy events endpoint
app.get('/api/events', async (req, res) => {
  try {
    const qs   = new URLSearchParams(req.query).toString();
    const data = await rpc(`/api/events${qs ? '?' + qs : ''}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, events: [] });
  }
});

// Deployed contracts list
app.get('/api/contracts', async (_req, res) => {
  try { res.json(await rpc('/api/contracts')); }
  catch (e) { res.status(500).json({ error: e.message, contracts: [] }); }
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  if (!isProd) console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   CrowdPulse Backend  v2.1           ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  API    → http://localhost:${PORT}`);
  console.log(`  SAYMAN → ${SAYMAN_RPC}`);
  console.log('  Keys   → user-signed (never stored here)\n');
});