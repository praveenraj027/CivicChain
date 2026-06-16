import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Cpu, CheckCircle2, AlertCircle, Loader2, Wallet } from 'lucide-react';
import { useWallet } from '../hooks/useWallet.jsx';
import { api } from '../utils/api.js';
import { buildReportTx } from '../utils/crypto.js';

const CATEGORIES = [
  'ROAD_DAMAGE', 'FLOOD', 'FIRE', 'STREETLIGHT',
  'GARBAGE', 'WATER_LEAK', 'UNSAFE_BUILDING', 'OTHER',
];

export default function SubmitPage({ onConnect }) {
  const { wallet, refresh } = useWallet();
  const [form, setForm]     = useState({ category: '', description: '', location: '' });
  const [ai, setAi]         = useState(null);
  const [status, setStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [txId, setTxId]     = useState('');
  const [errMsg, setErrMsg] = useState('');

  // AI preview while typing
  const runAi = useCallback(async (desc, cat) => {
    if (desc.length < 10) { setAi(null); return; }
    try { setAi(await api.aiVerify({ description: desc, category: cat })); } catch {}
  }, []);

  useEffect(() => {
    const id = setTimeout(() => runAi(form.description, form.category), 600);
    return () => clearTimeout(id);
  }, [form.description, form.category, runAi]);

  async function submit() {
    if (!wallet) return;
    setStatus('loading');
    setErrMsg('');
    try {
      // 1. Fresh nonce
      const { nonce } = await api.nonce(wallet.address);

      // 2. Build + sign tx — flat SAYMAN format
      const tx = await buildReportTx({
        wallet,
        nonce,
        category:    form.category,
        description: form.description,
        location:    form.location,
      });

      // 3. Broadcast
      const result = await api.broadcast(tx);
      setTxId(result.txId || result.id || '');
      setStatus('success');
      setForm({ category: '', description: '', location: '' });
      setAi(null);
      await refresh(wallet.address);
    } catch (e) {
      console.error(e);
      setErrMsg(e.message || 'Broadcast failed');
      setStatus('error');
    }
  }

  const valid = form.category && form.description.length >= 20 && form.location;

  if (!wallet) return (
    <div className="page center-page">
      <motion.div className="connect-prompt"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Wallet size={48} />
        <h2>Connect your wallet</h2>
        <p>Reports are signed with your wallet key and recorded on-chain.</p>
        <button className="btn-primary" onClick={onConnect}>Connect Wallet</button>
      </motion.div>
    </div>
  );

  return (
    <div className="page">
      <motion.div className="form-card"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>

        <h2 className="form-title">Submit a Report</h2>
        <p className="form-sub">Signed with your wallet · broadcast to SAYMAN chain.</p>

        <div className="field">
          <label>Category</label>
          <div className="cat-grid">
            {CATEGORIES.map(c => (
              <button key={c}
                className={`cat-btn ${form.category === c ? 'active' : ''}`}
                onClick={() => setForm(f => ({ ...f, category: c }))}>
                {c.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Description <span className="hint">min 20 chars</span></label>
          <textarea rows={4}
            placeholder="Describe the issue clearly — what you saw, severity, any context."
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <span className="char-count">{form.description.length} / 500</span>
        </div>

        <div className="field">
          <label>Location</label>
          <input type="text"
            placeholder="Street name, landmark, GPS coords…"
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
        </div>

        <AnimatePresence>
          {ai && (
            <motion.div className={`ai-badge ${ai.isValid ? 'valid' : 'warn'}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}>
              <Cpu size={14} />
              <span>AI: <b>{ai.aiCategory.replace(/_/g, ' ')}</b> — {ai.confidence}% confidence</span>
              {ai.isValid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {status === 'success' && (
            <motion.div className="alert success"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CheckCircle2 size={14} />
              &nbsp;Report broadcast!{txId && <> Tx: <code>{txId.slice(0, 16)}…</code></>}
            </motion.div>
          )}
          {status === 'error' && (
            <motion.div className="alert error"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AlertCircle size={14} />
              &nbsp;{errMsg || 'Broadcast failed — check balance and retry.'}
            </motion.div>
          )}
        </AnimatePresence>

        <button className="btn-primary full" onClick={submit}
          disabled={!valid || status === 'loading'}>
          {status === 'loading'
            ? <><Loader2 size={14} className="spin" /> Signing &amp; Broadcasting…</>
            : <><Send size={14} /> Submit Report</>}
        </button>

        <p className="wallet-hint">Signing as <code>{wallet.address.slice(0, 10)}…</code></p>
      </motion.div>
    </div>
  );
}