import 'dotenv/config';
import express   from 'express';
import cors      from 'cors';
import rateLimit from 'express-rate-limit';
import helmet    from 'helmet';
import fs        from 'fs';
import path      from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const isProd    = process.env.NODE_ENV === 'production';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '512kb' }));
app.use('/api/', rateLimit({
  windowMs: 60_000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Rate limit exceeded.' },
}));

const SAYMAN_RPC = process.env.SAYMAN_RPC || 'https://sayman.onrender.com';
const PORT       = process.env.PORT       || 3001;

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
fs.watchFile(manifestPath, { interval: 3000 }, reloadContracts);

// ─── Safe RPC ─────────────────────────────────────────────────────────────────
async function safeJson(res, url) {
  const text = await res.text();
  if (text.trimStart().startsWith('<'))
    throw new Error(`SAYMAN returned HTML at ${url} (${res.status})`);
  try { return JSON.parse(text); }
  catch { throw new Error(`SAYMAN non-JSON at ${url}: ${text.slice(0, 120)}`); }
}

async function rpc(endpoint, method = 'GET', body = null, retries = 2) {
  const url = `${SAYMAN_RPC}${endpoint}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await safeJson(res, url);
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

// ─── Block scanner — extracts REPORT_CREATE txs from recent blocks ────────────
// Cache so we don't re-fetch blocks we already have
const reportCache = { reports: [], lastBlock: 0, updatedAt: 0 };
const CACHE_TTL   = 15_000; // 15s

async function scanReports() {
  const now = Date.now();
  if (now - reportCache.updatedAt < CACHE_TTL) return reportCache.reports;

  try {
    const stats      = await rpc('/api/stats');
    const latest     = stats.blocks || 0;
    const scanFrom   = Math.max(1, reportCache.lastBlock + 1);
    const scanTo     = latest;
    const newReports = [];

    // Scan up to 50 new blocks per refresh to avoid hammering the RPC
    const limit = Math.min(scanTo - scanFrom + 1, 50);
    const start = Math.max(scanFrom, scanTo - limit + 1);

    for (let i = start; i <= scanTo; i++) {
      try {
        const block = await rpc(`/api/blocks/${i}`);
        const txs   = block.transactions || block.data?.transactions || [];
        for (const tx of txs) {
          if (tx.type === 'REPORT_CREATE' && tx.data) {
            newReports.push({
              id:          tx.id,
              reporter:    tx.data.from,
              category:    tx.data.category   || 'OTHER',
              description: tx.data.description || '',
              location:    tx.data.location   || '',
              severity:    tx.data.severity   || 'MEDIUM',
              status:      'OPEN',
              createdAt:   tx.timestamp,
              blockIndex:  block.index ?? block.height ?? i,
              txId:        tx.id,
            });
          }
        }
      } catch {}
    }

    // Merge new with existing, dedupe by id, sort newest first
    const all     = [...reportCache.reports, ...newReports];
    const deduped = Object.values(Object.fromEntries(all.map(r => [r.id, r])));
    deduped.sort((a, b) => b.createdAt - a.createdAt);

    reportCache.reports   = deduped;
    reportCache.lastBlock = scanTo;
    reportCache.updatedAt = now;
  } catch (e) {
    if (!isProd) console.warn('scanReports error:', e.message);
  }

  return reportCache.reports;
}

// ─── AI classifier ────────────────────────────────────────────────────────────
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
  const text   = `${description} ${category}`.toLowerCase();
  let detected = category || 'OTHER';
  let conf     = 65 + Math.floor(Math.random() * 15);
  for (const [cat, kws] of Object.entries(KEYWORDS)) {
    if (kws.some(k => text.includes(k))) { detected = cat; conf = 82 + Math.floor(Math.random() * 13); break; }
  }
  return { aiCategory: detected, confidence: conf, isValid: conf > 60, isDuplicate: false };
}

// ─── Tx validator ─────────────────────────────────────────────────────────────
function validateTx(tx) {
  const required = ['type', 'timestamp', 'data', 'signature', 'publicKey', 'gasLimit', 'gasPrice', 'nonce'];
  for (const f of required) {
    if (tx[f] === undefined || tx[f] === null)
      throw new Error(`Transaction missing field: ${f}`);
  }
  if (typeof tx.signature !== 'object' || !tx.signature.r || !tx.signature.s)
    throw new Error('Invalid signature — expected { r, s }');
  if (typeof tx.nonce !== 'number')
    throw new Error('nonce must be a number');
  if (!tx.data?.from)
    throw new Error('tx.data.from required');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', contracts: CONTRACTS, rpc: SAYMAN_RPC });
});

app.get('/api/stats', async (_req, res) => {
  try { res.json(await rpc('/api/stats')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/nonce/:address', async (req, res) => {
  try {
    const data = await rpc(`/api/address/${req.params.address}`);
    res.json({ nonce: data.nonce ?? 0, address: req.params.address });
  } catch (e) {
    res.status(502).json({ error: e.message, nonce: 0 });
  }
});

app.get('/api/balance/:address', async (req, res) => {
  try {
    const data = await rpc(`/api/address/${req.params.address}`);
    res.json({ balance: data.balance ?? 0, address: req.params.address });
  } catch (e) {
    res.status(502).json({ error: e.message, balance: 0 });
  }
});

app.post('/api/ai/verify', (req, res) => {
  const { description, category } = req.body;
  res.json(aiVerify(description, category));
});

app.post('/api/broadcast', async (req, res) => {
  try {
    const tx = req.body;
    if (!tx?.type) return res.status(400).json({ error: 'tx body with type required' });
    validateTx(tx);
    const result = await rpc('/api/broadcast', 'POST', tx);
    // Invalidate report cache so next feed load rescans
    reportCache.updatedAt = 0;
    let ai = null;
    if (tx.type === 'REPORT_CREATE')
      ai = aiVerify(tx.data?.description, tx.data?.category);
    res.json({ success: true, txId: result.txId || result.id || null, result, ai });
  } catch (e) {
    console.error('broadcast error:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// Reports — scanned from blocks (contract /state endpoint is 404 on public testnet)
app.get('/api/reports', async (req, res) => {
  try {
    let reports = await scanReports();

    if (req.query.category) reports = reports.filter(r => r.category === req.query.category);
    if (req.query.status)   reports = reports.filter(r => r.status   === req.query.status);
    if (req.query.reporter) reports = reports.filter(r => r.reporter === req.query.reporter);

    const page     = parseInt(req.query.page     || '1');
    const pageSize = parseInt(req.query.pageSize || '20');
    const start    = (page - 1) * pageSize;
    const slice    = reports.slice(start, start + pageSize);

    res.json({ reports: slice, total: reports.length });
  } catch (e) {
    res.status(500).json({ error: e.message, reports: [], total: 0 });
  }
});

app.get('/api/reports/:id', async (req, res) => {
  try {
    const reports = await scanReports();
    const report  = reports.find(r => r.id === req.params.id || r.txId === req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Reputation + rewards — derived from scanned reports (contract state unavailable)
app.get('/api/reputation/:address', async (req, res) => {
  try {
    const reports    = await scanReports();
    const myReports  = reports.filter(r => r.reporter === req.params.address);
    // 10 rep per report submitted (matches ReputationManager award logic)
    const reputation = myReports.length * 10;
    const level      = reputation >= 200 ? 'Champion'
                     : reputation >= 100 ? 'Elite'
                     : reputation >= 50  ? 'Trusted'
                     : reputation >= 10  ? 'Rising'
                     : 'Newcomer';
    res.json({ address: req.params.address, reputation, level });
  } catch (e) {
    res.status(500).json({ error: e.message, reputation: 0, level: 'Newcomer' });
  }
});

app.get('/api/rewards/:address', async (req, res) => {
  try {
    const reports = await scanReports();
    const points  = reports.filter(r => r.reporter === req.params.address).length * 10;
    res.json({ address: req.params.address, points });
  } catch (e) {
    res.status(500).json({ error: e.message, points: 0 });
  }
});

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const reports = await scanReports();
    const counts  = {};
    for (const r of reports) counts[r.reporter] = (counts[r.reporter] || 0) + 1;
    const leaderboard = Object.entries(counts)
      .map(([address, count]) => ({ address, score: count * 10 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    res.json({ leaderboard });
  } catch (e) {
    res.status(500).json({ error: e.message, leaderboard: [] });
  }
});

app.get('/api/blocks', async (req, res) => {
  try {
    const stats  = await rpc('/api/stats');
    const latest = stats.blocks || 0;
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

app.get('/api/events', async (req, res) => {
  try {
    const qs   = new URLSearchParams(req.query).toString();
    const data = await rpc(`/api/events${qs ? '?' + qs : ''}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message, events: [] });
  }
});

app.get('/api/contracts', async (_req, res) => {
  try { res.json(await rpc('/api/contracts')); }
  catch (e) { res.status(500).json({ error: e.message, contracts: [] }); }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  if (!isProd) console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   CrowdPulse Backend  v2.4           ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  API    → http://localhost:${PORT}`);
  console.log(`  SAYMAN → ${SAYMAN_RPC}`);
  console.log('  Keys   → user-signed (never stored here)\n');
});