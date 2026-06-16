import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Wallet, LogOut, ChevronDown, Copy, CheckCircle2 } from 'lucide-react';
import { useWallet } from '../hooks/useWallet.jsx';
import WalletModal from './WalletModal.jsx';

const TABS = ['Feed', 'Submit', 'Explorer', 'Profile'];

export default function Header({ tab, setTab }) {
  const { wallet, balance, reputation, disconnect } = useWallet();
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu]   = useState(false);
  const [copied, setCopied]       = useState(false);

  function copyAddr() {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const short = addr => addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : '';

  return (
    <>
      <header className="header">
        <div className="header-inner">
          {/* Logo */}
          <div className="logo">
            <motion.div
              className="logo-icon"
              animate={{ rotate: [0, 360] }}
              transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
            >
              <Radio size={18} />
            </motion.div>
            <span>CrowdPulse</span>
          </div>

          {/* Tabs */}
          <nav className="nav-tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`nav-tab ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
                {tab === t && (
                  <motion.div className="tab-underline" layoutId="underline" />
                )}
              </button>
            ))}
          </nav>

          {/* Wallet */}
          {wallet ? (
            <div className="wallet-chip-wrap">
              <button className="wallet-chip" onClick={() => setShowMenu(v => !v)}>
                <span className="wallet-dot" />
                <span>{short(wallet.address)}</span>
                <ChevronDown size={12} />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    className="wallet-menu"
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div className="wallet-menu-addr">
                      <code>{wallet.address}</code>
                      <button className="icon-btn small" onClick={copyAddr}>
                        {copied ? <CheckCircle2 size={12}/> : <Copy size={12}/>}
                      </button>
                    </div>
                    <div className="wallet-menu-stats">
                      <span>Balance <b>{balance}</b></span>
                      <span>Rep <b>{reputation}</b></span>
                    </div>
                    <button className="wallet-menu-item danger" onClick={() => { setShowMenu(false); disconnect(); }}>
                      <LogOut size={13} /> Disconnect
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button className="btn-connect" onClick={() => setShowModal(true)}>
              <Wallet size={14} /> Connect Wallet
            </button>
          )}
        </div>
      </header>

      <AnimatePresence>
        {showModal && <WalletModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
    </>
  );
}