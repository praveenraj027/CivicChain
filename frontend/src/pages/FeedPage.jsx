import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Clock, CheckCircle2, AlertCircle, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { api } from '../utils/api.js';

const CATEGORY_COLORS = {
  ROAD_DAMAGE:     '#f97316',
  FLOOD:           '#3b82f6',
  FIRE:            '#ef4444',
  STREETLIGHT:     '#eab308',
  GARBAGE:         '#84cc16',
  WATER_LEAK:      '#06b6d4',
  UNSAFE_BUILDING: '#a855f7',
  OTHER:           '#6b7280',
};

const STATUS_ICONS = {
  OPEN:       <AlertCircle size={14} />,
  VERIFIED:   <CheckCircle2 size={14} />,
  RESOLVED:   <CheckCircle2 size={14} />,
};

function ReportCard({ report, index }) {
  const color = CATEGORY_COLORS[report.category] || CATEGORY_COLORS.OTHER;
  const ago = ts => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  };

  return (
    <motion.div
      className="report-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      style={{ '--accent': color }}
    >
      <div className="rc-top">
        <span className="rc-category" style={{ background: color + '22', color }}>
          {report.category?.replace('_', ' ')}
        </span>
        <span className={`rc-status ${report.status?.toLowerCase()}`}>
          {STATUS_ICONS[report.status]} {report.status}
        </span>
      </div>
      <p className="rc-desc">{report.description}</p>
      <div className="rc-meta">
        <span><MapPin size={11} /> {report.location || 'Unknown'}</span>
        <span><Clock size={11} /> {ago(report.createdAt)}</span>
        <span className="rc-addr">{report.reporter?.slice(0,8)}…</span>
      </div>
      <div className="rc-bar" style={{ background: color }} />
    </motion.div>
  );
}

export default function FeedPage() {
  const [reports, setReports]   = useState([]);
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [r, s] = await Promise.allSettled([api.reports(), api.stats()]);
      if (r.status === 'fulfilled') setReports(r.value.reports || []);
      if (s.status === 'fulfilled') setStats(s.value);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => load(true), 10_000);
    return () => clearInterval(id);
  }, []);

  const filtered = filter === 'ALL' ? reports : reports.filter(r => r.category === filter);
  const categories = ['ALL', ...Object.keys(CATEGORY_COLORS)];

  return (
    <div className="page">
      {/* Stats bar */}
      {stats && (
        <motion.div className="stats-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {[
            ['Blocks', stats.blocks],
            ['Transactions', stats.transactions],
            ['Reports', reports.length],
            ['Peers', stats.peers],
          ].map(([label, val]) => (
            <div key={label} className="stat-pill">
              <span className="stat-val">{val ?? '—'}</span>
              <span className="stat-label">{label}</span>
            </div>
          ))}
          <button className="icon-btn ml-auto" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </motion.div>
      )}

      {/* Filter chips */}
      <div className="filter-row">
        {categories.map(c => (
          <button
            key={c}
            className={`filter-chip ${filter === c ? 'active' : ''}`}
            onClick={() => setFilter(c)}
            style={filter === c && c !== 'ALL' ? { background: CATEGORY_COLORS[c] + '22', color: CATEGORY_COLORS[c], borderColor: CATEGORY_COLORS[c] + '55' } : {}}
          >
            {c.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="center-loader">
          <Loader2 size={28} className="spin" />
          <p>Loading reports…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <TrendingUp size={40} />
          <p>No reports yet. Be the first to submit one.</p>
        </div>
      ) : (
        <div className="report-grid">
          <AnimatePresence>
            {filtered.map((r, i) => <ReportCard key={r.id || i} report={r} index={i} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}