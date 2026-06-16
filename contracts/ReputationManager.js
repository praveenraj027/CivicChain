/**
 * ReputationManager — CrowdPulse v2.1
 *
 * Fixes vs v1:
 *  - Scores bounded (can't go below 0)
 *  - Only authorised contracts can award/slash (stored in state.authorised)
 *  - Owner (deployer) can authorise other contracts
 *  - getLevels() returns thresholds for UI
 */

if (!state.reputation)  state.reputation  = {};  // address → score (int)
if (!state.history)     state.history     = {};  // address → [{delta, reason, ts}]
if (!state.authorised)  state.authorised  = {};  // address → true
if (!state.owner)       state.owner       = sender; // set on first deploy call

const LEVELS = [
  { label: 'Newcomer',  min: 0   },
  { label: 'Rising',    min: 10  },
  { label: 'Trusted',   min: 50  },
  { label: 'Elite',     min: 100 },
  { label: 'Champion',  min: 200 },
];

function requireOwner() {
  if (sender !== state.owner)
    throw new Error('Only owner can call this method');
}

function requireAuthorised() {
  if (!state.authorised[sender] && sender !== state.owner)
    throw new Error('Caller is not authorised to modify reputation');
}

function addHistory(address, delta, reason) {
  if (!state.history[address]) state.history[address] = [];
  state.history[address].push({ delta, reason, ts: Date.now() });
  // Keep last 50 events per address
  if (state.history[address].length > 50)
    state.history[address] = state.history[address].slice(-50);
}

// ─── Methods ──────────────────────────────────────────────────────────────────

if (method === 'authorise') {
  requireOwner();
  if (!args.address) throw new Error('address required');
  state.authorised[args.address] = true;
  return { success: true };
}

if (method === 'revokeAuthorisation') {
  requireOwner();
  if (!args.address) throw new Error('address required');
  delete state.authorised[args.address];
  return { success: true };
}

if (method === 'award') {
  requireAuthorised();
  const { address, points, reason } = args;
  if (!address)              throw new Error('address required');
  if (!points || points <= 0) throw new Error('points must be positive');

  state.reputation[address] = (state.reputation[address] || 0) + Math.floor(points);
  addHistory(address, +Math.floor(points), reason || 'award');

  emit('ReputationAwarded', { address, points, newScore: state.reputation[address] });
  return { success: true, newScore: state.reputation[address] };
}

if (method === 'slash') {
  requireAuthorised();
  const { address, points, reason } = args;
  if (!address)              throw new Error('address required');
  if (!points || points <= 0) throw new Error('points must be positive');

  const current = state.reputation[address] || 0;
  state.reputation[address] = Math.max(0, current - Math.floor(points));
  addHistory(address, -Math.floor(points), reason || 'slash');

  emit('ReputationSlashed', { address, points, newScore: state.reputation[address] });
  return { success: true, newScore: state.reputation[address] };
}

if (method === 'getScore') {
  const { address } = args;
  if (!address) throw new Error('address required');
  const score = state.reputation[address] || 0;
  const level = [...LEVELS].reverse().find(l => score >= l.min) || LEVELS[0];
  return { address, score, level: level.label };
}

if (method === 'getLeaderboard') {
  const limit = Math.min(50, parseInt(args.limit || 20));
  const board = Object.entries(state.reputation)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([address, score]) => {
      const level = [...LEVELS].reverse().find(l => score >= l.min) || LEVELS[0];
      return { address, score, level: level.label };
    });
  return { leaderboard: board };
}

if (method === 'getHistory') {
  const { address } = args;
  if (!address) throw new Error('address required');
  return { history: state.history[address] || [] };
}

if (method === 'getLevels') {
  return { levels: LEVELS };
}