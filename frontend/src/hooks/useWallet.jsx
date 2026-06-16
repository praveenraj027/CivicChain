import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { generateWallet, importWallet } from '../utils/crypto.js';
import { api } from '../utils/api.js';

const WalletCtx = createContext(null);

const STORAGE_KEY = 'cp_wallet_v2';

export function WalletProvider({ children }) {
  const [wallet, setWallet]     = useState(null); // { privateKey, publicKey, address }
  const [balance, setBalance]   = useState(0);
  const [reputation, setReputation] = useState(0);
  const [rewards, setRewards]   = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Reload on-chain data for connected wallet
  const refresh = useCallback(async (addr) => {
    if (!addr) return;
    try {
      const [b, r, rw] = await Promise.allSettled([
        api.balance(addr),
        api.reputation(addr),
        api.rewards(addr),
      ]);
      if (b.status === 'fulfilled') setBalance(b.value.balance ?? 0);
      if (r.status === 'fulfilled') setReputation(r.value.reputation ?? 0);
      if (rw.status === 'fulfilled') setRewards(rw.value.points ?? 0);
    } catch {}
  }, []);

  // Restore wallet from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const w = JSON.parse(saved);
        setWallet(w);
        refresh(w.address);
      }
    } catch {}
  }, []);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!wallet) return;
    const id = setInterval(() => refresh(wallet.address), 15_000);
    return () => clearInterval(id);
  }, [wallet, refresh]);

  const connect = useCallback(async (mode, privateKey) => {
    setLoading(true);
    setError(null);
    try {
      const w = mode === 'import' ? await importWallet(privateKey) : await generateWallet();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
      setWallet(w);
      await refresh(w.address);
      return w;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setWallet(null);
    setBalance(0);
    setReputation(0);
    setRewards(0);
  }, []);

  return (
    <WalletCtx.Provider value={{ wallet, balance, reputation, rewards, loading, error, connect, disconnect, refresh }}>
      {children}
    </WalletCtx.Provider>
  );
}

export const useWallet = () => useContext(WalletCtx);