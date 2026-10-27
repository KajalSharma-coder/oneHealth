const router = require('express').Router();
const Report = require('../models/Report');
const AlertValidation = require('../models/AlertValidation');
const detect = require('../detect');
const { requirePermission, writeAudit } = require('../auth');
const { selectAnalysisWindow } = require('../alertWindow');

const DAY = 24 * 60 * 60 * 1000;
const datasetFilter = (datasetId) => datasetId?.startsWith('legacy:')
  ? { datasetId: { $exists: false }, sourceName: decodeURIComponent(datasetId.slice('legacy:'.length)) }
  : { datasetId };
const analysisWindow = async (datasetId) => {
  const filter = datasetId ? datasetFilter(datasetId) : {};
  const rows = await Report.find(filter).lean();
  return selectAnalysisWindow(rows, datasetId);
};
const cleanLocation = (value) => String(value || '').trim().slice(0, 80);
const cleanNote = (value) => String(value || '').trim().slice(0, 240);
const VALID_STATUSES = new Set(['validated', 'review', 'dismissed']);
const RESPONSE_STATUSES = new Set(['new', 'investigating', 'sample_collected', 'contained', 'resolved']);

const publicValidation = (validation) => validation && ({
  status: validation.status,
  responseStatus: validation.responseStatus || 'new',
  note: validation.note,
  by: validation.by,
  role: validation.role,
  at: validation.at instanceof Date ? validation.at.toISOString() : validation.at,
  responseUpdatedAt: validation.responseUpdatedAt instanceof Date ? validation.responseUpdatedAt.toISOString() : validation.responseUpdatedAt,
});

const attachManualValidation = async (alerts) => {
  if (!alerts.length) return alerts;
  const validations = await AlertValidation.find({ location: { $in: alerts.map((alert) => alert.location) } }).lean();
  const byLocation = new Map(validations.map((validation) => [validation.location, publicValidation(validation)]));
  return alerts.map((alert) => {
    const manual = byLocation.get(alert.location);
    if (!manual) return alert;
    return {
      ...alert,
      manualValidation: manual,
      validationStatus: manual.status === 'dismissed' ? 'weak' : manual.status,
    };
  });
};

// GET /api/alerts
router.get('/alerts', requirePermission('alerts:read'), async (req, res) => {
  try {
    const datasetId = req.query.datasetId ? String(req.query.datasetId) : '';
    const { reports, referenceDate } = await analysisWindow(datasetId);
    const alerts = await detect(reports, referenceDate);
    const diagnostics = await detect.diagnostics(reports, referenceDate);
    return res.json({
      alerts: await attachManualValidation(alerts),
      diagnostics,
      datasetId: datasetId || null,
      referenceDate: referenceDate.toISOString(),
      analyzedRows: reports.length,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /api/alerts/:location/validate  { status, note? }
router.post('/alerts/:location/validate', requirePermission('alerts:validate'), async (req, res) => {
  const location = cleanLocation(req.params.location);
  const status = cleanLocation(req.body.status);
  if (!location) return res.status(400).json({ error: 'location is required' });
  if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: 'status must be validated, review or dismissed' });

  const validation = await AlertValidation.findOneAndUpdate(
    { location },
    {
      location,
      status,
      note: cleanNote(req.body.note),
      by: req.user.username,
      role: req.user.role,
      at: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit('alert.validation.updated', req.user, {
    location,
    status,
    notePresent: Boolean(validation.note),
  }, req);
  res.json({ location, manualValidation: publicValidation(validation) });
});

// POST /api/alerts/:location/respond  { responseStatus, note? }
router.post('/alerts/:location/respond', requirePermission('alerts:validate'), async (req, res) => {
  const location = cleanLocation(req.params.location);
  const responseStatus = cleanLocation(req.body.responseStatus);
  if (!location) return res.status(400).json({ error: 'location is required' });
  if (!RESPONSE_STATUSES.has(responseStatus)) {
    return res.status(400).json({ error: 'responseStatus must be new, investigating, sample_collected, contained or resolved' });
  }

  const validation = await AlertValidation.findOneAndUpdate(
    { location },
    {
      $set: {
        location,
        responseStatus,
        note: cleanNote(req.body.note),
        by: req.user.username,
        role: req.user.role,
        responseUpdatedAt: new Date(),
      },
      $setOnInsert: {
        status: 'review',
        at: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAudit('alert.response.updated', req.user, {
    location,
    responseStatus,
    notePresent: Boolean(validation.note),
  }, req);
  res.json({ location, manualValidation: publicValidation(validation) });
});

// GET /api/ml/model
router.get('/ml/model', async (req, res) => {
  const engine = await import('../../shared/anomalyEngine.mjs');
  res.json(engine.ML_MODEL);
});

// GET /api/dashboard/stats
router.get('/dashboard/stats', requirePermission('reports:read'), async (req, res) => {
  const { reports, referenceDate } = await analysisWindow(req.query.datasetId ? String(req.query.datasetId) : '');
  const week = { human: 0, animal: 0, environment: 0 };
  const prevWeek = { ...week };
  for (const r of reports) {
    const day = Math.floor((referenceDate - r.date) / DAY);
    if (day < 7) week[r.sector] += r.cases;
    else if (day < 14) prevWeek[r.sector] += r.cases;
  }
  res.json({ week, prevWeek, activeAlerts: (await detect(reports, referenceDate)).length });
});

module.exports = router;
