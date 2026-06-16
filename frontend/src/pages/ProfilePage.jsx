import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { User, Star, Trophy, FileText, Wallet, TrendingUp, Shield, Zap } from 'lucide-react';
import { useWallet } from '../hooks/useWallet.jsx';
import { api } from '../utils/api.js';

const BADGES = [
  { id: 'first_report',  icon: <FileText size={16} />,  label: 'First Report',    thresh: 1,  field: 'reports'  },
  { id: 'reporter_5',    icon: <TrendingUp size={16} />, label: '5 Reports',       thresh: 5,  field: 'reports'  },
  { id: 'trusted',       icon: <Shield size={16} />,    label: 'Trusted',         thresh: 50, field: 'rep'      },
  { id: 'power_user',    icon: <Zap size={16} />,       label: 'Power User',      thresh: 10, field: 'reports'  },
  { id: 'elite',         icon: <Star size={16} />,      label: 'Elite Reporter',  thresh: 100,field: 'rep'      },
  { id: 'champion',      icon: <Trophy size={16} />,    label: 'Champion',        thresh: 200,field: 'rep'      },
];

function trustLevel(rep) {
  if (rep >= 200) return { label: 'Champion',  color: '#f59e0b' };
  if (rep >= 100) return { label: 'Elite',      color: '#a855f7' };
  if (rep >= 50)  return { label: 'Trusted',    color: '#3b82f6' };
  if (rep >= 10)  return { label: 'Rising',     color: '#22c55e' };
  return           { label: 'Newcomer',  color: '#6b7280' };
}

export default function ProfilePage({ onConnect }) {
  const { wallet, balance, reputation, rewards } = useWallet();
  const [myReports, setMyReports] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    if (!wallet) return;
    api.reports({ reporter: wallet.address }).then(d => setMyReports(d.reports || [])).catch(() => {});
    api.leaderboard().then(d => setLeaderboard(d.leaderboard || [])).catch(() => {});
  }, [wallet]);

  if (!wallet) return (
    <div className="page center-page">
      <motion.div className="connect-prompt" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <User size={48} />
        <h2>Connect your wallet</h2>
        <p>View your reputation, badges, and submitted reports.</p>
        <button className="btn-primary" onClick={onConnect}>Connect Wallet</button>
      </motion.div>
    </div>
  );

  const trust = trustLevel(reputation);
  const earned = BADGES.filter(b => {
    const val = b.field === 'rep' ? reputation : myReports.length;
    return val >= b.thresh;
  });

  return (
    <div className="page">
      {/* Identity card */}
      <motion.div className="profile-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="profile-avatar">
          <User size={32} />
        </div>
        <div className="profile-info">
          <code className="profile-addr">{wallet.address}</code>
          <span className="trust-badge" style={{ color: trust.color, borderColor: trust.color + '44', background: trust.color + '11' }}>
            {trust.label}
          </span>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="profile-stats">
        {[
          { icon: <Wallet size={18} />,   label: 'Balance',     val: balance },
          { icon: <Star size={18} />,     label: 'Reputation',  val: reputation },
          { icon: <Trophy size={18} />,   label: 'Reward Pts',  val: rewards },
          { icon: <FileText size={18} />, label: 'Reports',     val: myReports.length },
        ].map(({ icon, label, val }, i) => (
          <motion.div key={label} className="profile-stat" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.07 }}>
            {icon}
            <span className="ps-val">{val}</span>
            <span className="ps-label">{label}</span>
          </motion.div>
        ))}
      </div>

      {/* Badges */}
      <div className="section">
        <h3>Badges</h3>
        <div className="badge-grid">
          {BADGES.map(b => {
            const unlocked = earned.find(e => e.id === b.id);
            return (
              <motion.div key={b.id} className={`badge-item ${unlocked ? 'unlocked' : 'locked'}`} whileHover={{ scale: 1.05 }}>
                {b.icon}
                <span>{b.label}</span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Leaderboard */}
      <div className="section">
        <h3>Leaderboard</h3>
        <div className="leaderboard">
          {leaderboard.slice(0, 10).map((entry, i) => (
            <div key={entry.address} className={`lb-row ${entry.address === wallet.address ? 'mine' : ''}`}>
              <span className="lb-rank">#{i + 1}</span>
              <code className="lb-addr">{entry.address.slice(0, 12)}…</code>
              <span className="lb-score">{entry.score}</span>
            </div>
          ))}
          {leaderboard.length === 0 && <p className="muted">No data yet.</p>}
        </div>
      </div>
    </div>
  );
}