import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WalletProvider } from './hooks/useWallet.jsx';
import Header from './components/Header.jsx';
import WalletModal from './components/WalletModal.jsx';
import FeedPage from './pages/FeedPage.jsx';
import SubmitPage from './pages/SubmitPage.jsx';
import ExplorerPage from './pages/ExplorerPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

const PAGE_MAP = {
  Feed:     FeedPage,
  Submit:   SubmitPage,
  Explorer: ExplorerPage,
  Profile:  ProfilePage,
};

function AppInner() {
  const [tab, setTab]           = useState('Feed');
  const [walletModal, setWalletModal] = useState(false);

  const Page = PAGE_MAP[tab];

  return (
    <div className="app">
      {/* Ambient grid background */}
      <div className="bg-grid" aria-hidden />
      <div className="bg-glow" aria-hidden />

      <Header tab={tab} setTab={setTab} />

      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            style={{ width: '100%' }}
          >
            <Page onConnect={() => setWalletModal(true)} />
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {walletModal && <WalletModal onClose={() => setWalletModal(false)} />}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <AppInner />
    </WalletProvider>
  );
}