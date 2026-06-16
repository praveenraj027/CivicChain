const BASE = import.meta.env.VITE_API_URL || '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  health:      ()       => req('/health'),
  stats:       ()       => req('/api/stats'),
  nonce:       (addr)   => req(`/api/nonce/${addr}`),
  balance:     (addr)   => req(`/api/balance/${addr}`),
  reputation:  (addr)   => req(`/api/reputation/${addr}`),
  rewards:     (addr)   => req(`/api/rewards/${addr}`),
  reports:     (params) => req('/api/reports?' + new URLSearchParams(params || {})),
  report:      (id)     => req(`/api/reports/${id}`),
  leaderboard: ()       => req('/api/leaderboard'),
  blocks:      (n = 10) => req(`/api/blocks?count=${n}`),
  contracts:   ()       => req('/api/contracts'),
  aiVerify:    (body)   => req('/api/ai/verify',  { method: 'POST', body: JSON.stringify(body) }),
  // tx is the flat signed body from buildReportTx / buildContractCallTx
  broadcast:   (tx)     => req('/api/broadcast',  { method: 'POST', body: JSON.stringify(tx) }),
};