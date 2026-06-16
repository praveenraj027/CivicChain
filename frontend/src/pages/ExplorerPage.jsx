import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Blocks, FileCode, RefreshCw, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../utils/api.js';

function BlockRow({ block, index }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      className="block-row"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <div className="block-summary" onClick={() => setOpen(v => !v)}>
        <span className="block-num">#{block.index ?? block.height ?? '?'}</span>
        <span className="block-hash"><code>{(block.hash || '').slice(0, 20)}…</code></span>
        <span className="block-txs">{block.transactions?.length ?? 0} txs</span>
        <span className="block-time">{block.timestamp ? new Date(block.timestamp).toLocaleTimeString() : '—'}</span>
        <ChevronRight size={14} className={`chevron ${open ? 'open' : ''}`} />
      </div>
      {open && (
        <motion.div className="block-detail" initial={{ height: 0 }} animate={{ height: 'auto' }}>
          <pre>{JSON.stringify(block, null, 2)}</pre>
        </motion.div>
      )}
    </motion.div>
  );
}

export default function ExplorerPage() {
  const [blocks, setBlocks]       = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('blocks');

  async function load() {
    setLoading(true);
    try {
      const [b, c] = await Promise.allSettled([api.blocks(15), api.contracts()]);
      if (b.status === 'fulfilled') setBlocks(b.value.blocks || []);
      if (c.status === 'fulfilled') setContracts(c.value.contracts || Object.values(c.value).filter(v => typeof v === 'object') || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <div className="explorer-header">
        <h2>Block Explorer</h2>
        <button className="icon-btn" onClick={load}><RefreshCw size={15} /></button>
      </div>

      <div className="tab-row" style={{ marginBottom: '1.5rem' }}>
        <button className={`tab ${tab === 'blocks' ? 'active' : ''}`} onClick={() => setTab('blocks')}>
          <Blocks size={13} /> Blocks
        </button>
        <button className={`tab ${tab === 'contracts' ? 'active' : ''}`} onClick={() => setTab('contracts')}>
          <FileCode size={13} /> Contracts
        </button>
      </div>

      {loading ? (
        <div className="center-loader"><Loader2 size={24} className="spin" /></div>
      ) : tab === 'blocks' ? (
        <div className="block-list">
          {blocks.length === 0
            ? <p className="muted">No blocks loaded — check chain connection.</p>
            : blocks.map((b, i) => <BlockRow key={b.hash || i} block={b} index={i} />)}
        </div>
      ) : (
        <div className="contract-list">
          {contracts.length === 0
            ? <p className="muted">No contracts found.</p>
            : contracts.map((c, i) => (
              <motion.div key={i} className="contract-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                <span className="contract-name">{c.name || 'Unknown'}</span>
                <code className="contract-addr">{c.address || c.id || '—'}</code>
                <span className="contract-version">v{c.version || '?'}</span>
              </motion.div>
            ))}
        </div>
      )}
    </div>
  );
}