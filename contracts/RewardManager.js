/**
 * RewardManager — CrowdPulse v2.1
 *
 * Fixes vs v1:
 *  - Points cannot go below 0
 *  - Owner/authorised-only mutations (same pattern as ReputationManager)
 *  - Claim cooldown to prevent gaming
 *  - claimReward emits event for off-chain indexing
 */

if (!state.points)      state.points      = {};  // address → int
if (!state.claimed)     state.claimed     = {};  // address → { total, lastClaim }
if (!state.authorised)  state.authorised  = {};
if (!state.owner)       state.owner       = sender;

const REWARD_POINTS = {
  REPORT_CREATED:  10,
  REPORT_VERIFIED: 5,
  REPORT_RESOLVED: 20,
};

const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 day

function requireAuthorised() {
  if (!state.authorised[sender] && sender !== state.owner)
    throw new Error('Caller not authorised');
}

// ─── Methods ──────────────────────────────────────────────────────────────────

if (method === 'authorise') {
  if (sender !== state.owner) throw new Error('Only owner');
  if (!args.address) throw new Error('address required');
  state.authorised[args.address] = true;
  return { success: true };
}

if (method === 'addPoints') {
  requireAuthorised();
  const { address, points, reason } = args;
  if (!address)       throw new Error('address required');
  if (points <= 0)    throw new Error('points must be positive');

  state.points[address] = (state.points[address] || 0) + Math.floor(points);
  emit('PointsAdded', { address, points, reason, total: state.points[address] });
  return { success: true, total: state.points[address] };
}

if (method === 'deductPoints') {
  requireAuthorised();
  const { address, points, reason } = args;
  if (!address)    throw new Error('address required');
  if (points <= 0) throw new Error('points must be positive');

  const current = state.points[address] || 0;
  state.points[address] = Math.max(0, current - Math.floor(points));
  emit('PointsDeducted', { address, points, reason, total: state.points[address] });
  return { success: true, total: state.points[address] };
}

if (method === 'awardForAction') {
  requireAuthorised();
  const { address, action } = args;
  if (!address) throw new Error('address required');
  const pts = REWARD_POINTS[action];
  if (!pts) throw new Error(`Unknown action: ${action}`);

  state.points[address] = (state.points[address] || 0) + pts;
  emit('ActionRewarded', { address, action, points: pts, total: state.points[address] });
  return { success: true, points: pts, total: state.points[address] };
}

if (method === 'claimReward') {
  const address = sender;
  const now = Date.now();
  const rec = state.claimed[address] || { total: 0, lastClaim: 0 };

  if (now - rec.lastClaim < CLAIM_COOLDOWN_MS)
    throw new Error('Claim cooldown active — try again tomorrow');

  const balance = state.points[address] || 0;
  if (balance === 0) throw new Error('No points to claim');

  // Mark as claimed (balance stays — actual token transfer handled off-chain or by chain layer)
  state.claimed[address] = { total: rec.total + balance, lastClaim: now };

  emit('RewardClaimed', { address, points: balance, timestamp: now });
  return { success: true, claimed: balance };
}

if (method === 'getPoints') {
  const { address } = args;
  if (!address) throw new Error('address required');
  return { address, points: state.points[address] || 0 };
}

if (method === 'getRewardTable') {
  return { rewards: REWARD_POINTS };
}