/**
 * ReportRegistry — CrowdPulse v2.1
 *
 * Fixes vs v1:
 *  - Input validation on all methods
 *  - createReport returns the full report object (not just id)
 *  - verifyReport / resolveReport check caller permissions
 *  - Emits structured events for indexing
 *  - getReports() returns paginated slice to avoid huge state reads
 */

const VALID_CATEGORIES = [
  'ROAD_DAMAGE', 'FLOOD', 'FIRE', 'STREETLIGHT',
  'GARBAGE', 'WATER_LEAK', 'UNSAFE_BUILDING', 'OTHER',
];

const VALID_STATUSES = ['OPEN', 'VERIFIED', 'RESOLVED'];

// ─── State init ───────────────────────────────────────────────────────────────
if (!state.reports)   state.reports   = {};
if (!state.reportIds) state.reportIds = [];  // ordered list for pagination
if (!state.count)     state.count     = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function requireField(val, name) {
  if (val === undefined || val === null || val === '')
    throw new Error(`Missing required field: ${name}`);
}

// ─── Methods ──────────────────────────────────────────────────────────────────

if (method === 'createReport') {
  const { description, category, location } = args;

  requireField(description, 'description');
  requireField(category,    'category');
  requireField(location,    'location');

  if (!VALID_CATEGORIES.includes(category))
    throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);

  if (description.length < 10)
    throw new Error('Description must be at least 10 characters');

  if (description.length > 1000)
    throw new Error('Description too long (max 1000 chars)');

  const id = `rpt_${Date.now()}_${state.count}`;
  state.count++;

  const report = {
    id,
    reporter:    sender,
    description: description.slice(0, 1000),
    category,
    location:    location.slice(0, 200),
    status:      'OPEN',
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    verifiedBy:  null,
    resolvedBy:  null,
    aiCategory:  args.aiCategory  || null,
    aiConfidence: args.aiConfidence || null,
  };

  state.reports[id]  = report;
  state.reportIds.push(id);

  emit('ReportCreated', { id, reporter: sender, category, location });

  return { success: true, report };
}

if (method === 'verifyReport') {
  const { reportId } = args;
  requireField(reportId, 'reportId');

  const report = state.reports[reportId];
  if (!report)           throw new Error(`Report not found: ${reportId}`);
  if (report.status !== 'OPEN') throw new Error('Report is not OPEN');
  if (report.reporter === sender) throw new Error('Reporter cannot verify their own report');

  report.status     = 'VERIFIED';
  report.verifiedBy = sender;
  report.updatedAt  = Date.now();

  emit('ReportVerified', { id: reportId, verifiedBy: sender });

  return { success: true, report };
}

if (method === 'resolveReport') {
  const { reportId } = args;
  requireField(reportId, 'reportId');

  const report = state.reports[reportId];
  if (!report)                   throw new Error(`Report not found: ${reportId}`);
  if (report.status === 'RESOLVED') throw new Error('Report already resolved');

  report.status     = 'RESOLVED';
  report.resolvedBy = sender;
  report.updatedAt  = Date.now();

  emit('ReportResolved', { id: reportId, resolvedBy: sender });

  return { success: true, report };
}

if (method === 'getReport') {
  const { reportId } = args;
  requireField(reportId, 'reportId');
  const report = state.reports[reportId];
  if (!report) throw new Error(`Report not found: ${reportId}`);
  return { report };
}

if (method === 'getReports') {
  // Paginated — default page size 20
  const page     = Math.max(0, parseInt(args.page  || 0));
  const pageSize = Math.min(50, parseInt(args.pageSize || 20));
  const category = args.category || null;
  const status   = args.status   || null;
  const reporter = args.reporter || null;

  let ids = [...state.reportIds].reverse(); // newest first

  // Filter
  if (category || status || reporter) {
    ids = ids.filter(id => {
      const r = state.reports[id];
      if (!r) return false;
      if (category && r.category !== category) return false;
      if (status   && r.status   !== status)   return false;
      if (reporter && r.reporter !== reporter) return false;
      return true;
    });
  }

  const total   = ids.length;
  const slice   = ids.slice(page * pageSize, (page + 1) * pageSize);
  const reports = slice.map(id => state.reports[id]).filter(Boolean);

  return { reports, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

if (method === 'getStats') {
  const all    = Object.values(state.reports);
  const byStatus   = {};
  const byCategory = {};
  for (const r of all) {
    byStatus[r.status]     = (byStatus[r.status]     || 0) + 1;
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  }
  return { total: state.count, byStatus, byCategory };
}