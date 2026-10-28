const router = require('express').Router();
const multer = require('multer');
const crypto = require('crypto');
const Report = require('../models/Report');
const Dataset = require('../models/Dataset');
const { datasetIdForBuffer, legacyDatasetId } = require('../datasetIdentity');
const { requirePermission, writeAudit } = require('../auth');
const { parseReportCsvBuffer } = require('../csvImport');
const { withReportQuality } = require('../reportQuality');
const { ALL_DATASETS, isAllDatasets, sharedReportFilter, dedupeSharedReports } = require('../datasetScope');

const SECTORS = new Set(['human', 'animal', 'environment']);
const MAX_CSV_FILE_SIZE = 100 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_FILE_SIZE },
  fileFilter: (req, file, callback) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) return callback(null, true);
    return callback(new Error('Only CSV files are allowed'));
  },
});
const csvUpload = upload.single('file');
const cleanText = (value) => String(value ?? '').trim();
const cleanOptionalText = (value, max = 80) => {
  const text = cleanText(value).slice(0, max);
  return text || undefined;
};
const cleanCases = (value) => {
  const cases = Number(value);
  if (!Number.isFinite(cases) || cases < 1 || cases > 500) return null;
  return Math.round(cases);
};
const cleanCount = (value, max = 500) => {
  if (value === undefined || value === null || value === '') return 0;
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0 || count > max) return null;
  return Math.round(count);
};
const cleanEnum = (value, allowed, fallback) => {
  const key = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return allowed.has(key) ? key : fallback;
};
const cleanLimit = (value) => {
  if (value === undefined || value === null || value === '') return 50;
  const limit = Math.round(Number(value));
  if (!Number.isFinite(limit)) return null;
  return Math.max(1, Math.min(50000, limit));
};
const datasetFilter = (datasetId) => datasetId?.startsWith('legacy:')
  ? { datasetId: { $exists: false }, sourceName: decodeURIComponent(datasetId.slice('legacy:'.length)) }
  : { datasetId };
const cleanCoord = (value, min, max) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const cleanDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const recordFingerprint = (report) => crypto.createHash('sha256').update([
  report.date?.toISOString?.() || report.date || '', report.location, report.sector,
  report.disease, report.cases, report.latitude ?? '', report.longitude ?? '',
  report.species ?? '', report.sourceDataset ?? '', report.temperatureCelsius ?? '', report.precipitationMm ?? '',
].join('|')).digest('hex');
const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
// GET /api/reports/datasets
router.get('/datasets', requirePermission('reports:read'), async (req, res) => {
  try {
    const datasets = await Dataset.find({}).sort({ importedAt: -1 }).lean();
    const legacy = await Report.aggregate([
      { $match: { sourceType: 'csv', datasetId: { $exists: false }, sourceName: { $exists: true } } },
      { $group: { _id: '$sourceName', rowCount: { $sum: 1 }, dateMin: { $min: '$date' }, dateMax: { $max: '$date' }, importedAt: { $max: '$sourceUploadedAt' }, sourceDataset: { $first: '$sourceDataset' } } },
      { $sort: { importedAt: -1 } },
    ]);
    return res.json([
      ...datasets.map((dataset) => ({ ...dataset, id: dataset.datasetId })),
      ...legacy.map((dataset) => ({
        id: legacyDatasetId(dataset._id),
        datasetId: legacyDatasetId(dataset._id),
        fileName: `${dataset._id} (legacy import)`,
        sourceName: dataset._id,
        sourceDataset: dataset.sourceDataset,
        status: 'legacy',
        importedAt: dataset.importedAt,
        rowCount: dataset.rowCount,
        importedRows: dataset.rowCount,
        skippedRows: 0,
        dateMin: dataset.dateMin,
        dateMax: dataset.dateMax,
      })),
    ]);
  } catch (error) {
    console.error('Dataset listing failed:', error.message);
    return res.status(500).json({ error: 'Could not load imported datasets.' });
  }
});

// Dataset operations are restricted to admins, while dataset contents remain
// readable by every authorized viewer through the shared scope.
router.delete('/datasets/:datasetId', requirePermission('users:manage'), async (req, res) => {
  const datasetId = String(req.params.datasetId || '');
  if (!datasetId || datasetId === ALL_DATASETS || datasetId.startsWith('legacy:')) {
    return res.status(400).json({ error: 'Only persisted dataset IDs can be deleted.' });
  }
  const dataset = await Dataset.findOne({ datasetId });
  if (!dataset) return res.status(404).json({ error: 'Dataset not found.' });
  await Report.deleteMany({ datasetId });
  await Dataset.deleteOne({ datasetId });
  await writeAudit('reports.dataset.deleted', req.user, { datasetId, fileName: dataset.fileName }, req);
  return res.status(204).end();
});

// GET /api/reports?datasetId=<id>&sector=human&location=Jaipur&limit=50
router.get('/', requirePermission('reports:read'), async (req, res) => {
  try {
    const sector = cleanText(req.query.sector);
    const location = cleanText(req.query.location);
    const datasetId = req.query.datasetId ? String(req.query.datasetId) : ALL_DATASETS;
    const filter = isAllDatasets(datasetId)
      ? sharedReportFilter(await Dataset.find({ status: 'ready' }).distinct('datasetId'))
      : datasetFilter(datasetId);

    if (sector) {
      if (!SECTORS.has(sector)) return res.status(400).json({ error: 'sector must be human, animal or environment' });
      filter.sector = sector;
    }
    if (location) filter.location = location;

    const limit = cleanLimit(req.query.limit);
    if (!limit) return res.status(400).json({ error: 'limit must be a number from 1 to 50000' });

    const rows = await Report.find(filter).sort({ date: -1 }).limit(limit);
    res.json(isAllDatasets(datasetId) ? dedupeSharedReports(rows) : rows);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/reports/export.csv?datasetId=all&sector=human&location=Delhi
router.get('/export.csv', requirePermission('reports:read'), async (req, res) => {
  try {
    const datasetId = req.query.datasetId ? String(req.query.datasetId) : ALL_DATASETS;
    const filter = isAllDatasets(datasetId)
      ? sharedReportFilter(await Dataset.find({ status: 'ready' }).distinct('datasetId'))
      : datasetFilter(datasetId);
    if (req.query.sector) filter.sector = cleanText(req.query.sector);
    if (req.query.location) filter.location = cleanText(req.query.location);
    const loadedRows = await Report.find(filter).sort({ date: -1 }).limit(50000).lean();
    const rows = isAllDatasets(datasetId) ? dedupeSharedReports(loadedRows) : loadedRows;
    const headers = ['date', 'location', 'state', 'district', 'sector', 'disease', 'cases', 'latitude', 'longitude', 'temperatureCelsius', 'precipitationMm', 'datasetId', 'sourceType', 'sourceName', 'sourceUploadedBy', 'sourceUploadedAt', 'isSynthetic', 'dataQualityScore'];
    const body = rows.map((row) => headers.map((header) => csvEscape(row[header] instanceof Date ? row[header].toISOString() : row[header])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="onehealth-report-export.csv"');
    return res.send([headers.join(','), ...body].join('\n'));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// A dependency-free, printable PDF export. It intentionally contains only
// filtered provenance rows, making the output auditable and deterministic.
router.get('/export.pdf', requirePermission('reports:read'), async (req, res) => {
  try {
    const datasetId = req.query.datasetId ? String(req.query.datasetId) : ALL_DATASETS;
    const filter = isAllDatasets(datasetId)
      ? sharedReportFilter(await Dataset.find({ status: 'ready' }).distinct('datasetId'))
      : datasetFilter(datasetId);
    if (req.query.sector) filter.sector = cleanText(req.query.sector);
    if (req.query.location) filter.location = cleanText(req.query.location);
    const loadedRows = await Report.find(filter).sort({ date: -1 }).limit(50000).lean();
    const rows = isAllDatasets(datasetId) ? dedupeSharedReports(loadedRows) : loadedRows;
    const lines = ['OneHealth report export', `Generated: ${new Date().toISOString()}`, `Rows: ${rows.length}`, ''];
    rows.slice(0, 120).forEach((row) => lines.push(`${row.date ? new Date(row.date).toISOString().slice(0, 10) : '-'} | ${row.location || '-'} | ${row.sector || '-'} | ${row.disease || '-'} | cases ${row.cases ?? 0} | dataset ${row.datasetId || 'legacy'} | source ${row.sourceName || '-'}`));
    const escapePdf = (value) => String(value).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, ' ');
    const stream = `BT\n/F1 8 Tf\n40 800 Td\n${lines.map((line, index) => `${index ? '0 -11 Td\n' : ''}(${escapePdf(line.slice(0, 150))}) Tj`).join('\n')}\nET`;
    const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="onehealth-report-export.pdf"');
    return res.send(Buffer.from(pdf));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

const handleCsvUpload = (req, res, next) => {
  csvUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'CSV file must be 100 MB or smaller' });
    return res.status(400).json({ error: err.message });
  });
};

// POST /api/reports/import-csv/preview  multipart/form-data file=<csv>
router.post('/import-csv/preview', requirePermission('reports:write'), handleCsvUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const parsed = await parseReportCsvBuffer(req.file.buffer);
    if (parsed.error) return res.status(400).json(parsed);
    return res.json({
      fileName: req.file.originalname,
      rowCount: parsed.reports.length + parsed.skipped,
      importedRows: parsed.reports.length,
      skippedRows: parsed.skipped,
      dateRange: {
        min: parsed.reports.reduce((min, report) => (!min || report.date < min ? report.date : min), null),
        max: parsed.reports.reduce((max, report) => (!max || report.date > max ? report.date : max), null),
      },
      sample: parsed.reports.slice(0, 5).map(({ disease, sector, location, cases, date }) => ({ disease, sector, location, cases, date })),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// POST /api/reports/import-csv  multipart/form-data file=<csv>
router.post('/import-csv', requirePermission('reports:write'), handleCsvUpload, async (req, res) => {
  let dataset;
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

    const parsed = await parseReportCsvBuffer(req.file.buffer);
    const datasetId = datasetIdForBuffer(req.file.buffer);
    const dateMin = parsed.reports.reduce((min, report) => (!min || report.date < min ? report.date : min), null);
    const dateMax = parsed.reports.reduce((max, report) => (!max || report.date > max ? report.date : max), null);
    const uniqueReports = [];
    const seenFingerprints = new Set();
    for (const report of parsed.reports) {
      const fingerprint = recordFingerprint(report);
      if (seenFingerprints.has(fingerprint)) continue;
      seenFingerprints.add(fingerprint);
      uniqueReports.push({ ...report, recordFingerprint: fingerprint });
    }
    const duplicateRows = parsed.reports.length - uniqueReports.length;
    const sourceDataset = uniqueReports.find((report) => report.sourceDataset)?.sourceDataset;
    dataset = await Dataset.findOneAndUpdate(
      { datasetId },
      { datasetId, fileName: req.file.originalname, contentHash: datasetId, sourceDataset, uploadedBy: req.user.username, isSynthetic: uniqueReports.length > 0 && uniqueReports.every((report) => report.isSynthetic === true), status: 'importing', importedAt: new Date(), rowCount: parsed.reports.length + parsed.skipped, skippedRows: parsed.skipped + duplicateRows, rejectedRows: duplicateRows, dateMin, dateMax, headers: parsed.headers || [], error: undefined, validationErrors: [] },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (parsed.error) {
      dataset.status = 'failed';
      dataset.error = parsed.error;
      dataset.rejectedRows = parsed.skipped;
      dataset.validationErrors = [parsed.error];
      await dataset.save();
      return res.status(400).json({ ...parsed, datasetId });
    }

    // Identical bytes have the same stable ID: replace only that dataset.
    await Report.deleteMany({ datasetId });
    const parsedCaseTotal = parsed.reports.reduce((sum, report) => sum + report.cases, 0);
    const legacyMatch = await Report.aggregate([
      { $match: { datasetId: { $exists: false }, sourceType: 'csv', sourceName: req.file.originalname } },
      { $group: { _id: null, count: { $sum: 1 }, cases: { $sum: '$cases' }, min: { $min: '$date' }, max: { $max: '$date' }, sourceDataset: { $first: '$sourceDataset' } } },
    ]);
    const legacy = legacyMatch[0];
    if (legacy && legacy.count === parsed.reports.length && legacy.cases === parsedCaseTotal
      && String(legacy.min) === String(dateMin) && String(legacy.max) === String(dateMax)
      && (legacy.sourceDataset || '') === (sourceDataset || '')) {
      await Report.deleteMany({ datasetId: { $exists: false }, sourceType: 'csv', sourceName: req.file.originalname });
    }
    const reports = uniqueReports.map((report) => withReportQuality(report, {
      datasetId,
      sourceType: 'csv',
      sourceName: req.file.originalname,
      sourceUploadedBy: req.user.username,
      sourceUploadedAt: new Date(),
    }));
    const inserted = await Report.insertMany(reports, { ordered: false });
    dataset.status = 'ready';
    dataset.importedRows = inserted.length;
    dataset.rejectedRows = parsed.skipped + duplicateRows + (uniqueReports.length - inserted.length);
    await dataset.save();
    await writeAudit('reports.csv.imported', req.user, {
      fileName: req.file.originalname,
      inserted: inserted.length,
      skipped: parsed.skipped + duplicateRows,
    }, req);

    return res.status(201).json({
      inserted: inserted.length,
      skipped: parsed.skipped + duplicateRows,
      fileName: req.file.originalname,
      datasetId,
      status: dataset.status,
      rowCount: dataset.rowCount,
      importedRows: dataset.importedRows,
      skippedRows: dataset.skippedRows,
      dateRange: { min: dateMin, max: dateMax },
    });
  } catch (err) {
    if (dataset) {
      dataset.status = 'failed';
      dataset.error = err.message;
      await dataset.save().catch(() => {});
    }
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/reports  { disease, sector, location, cases, date? }
router.post('/', requirePermission('reports:write'), async (req, res) => {
  try {
    const disease = cleanText(req.body.disease);
    const sector = cleanText(req.body.sector);
    const location = cleanText(req.body.location);
    if (!disease || !location || !SECTORS.has(sector)) {
      return res.status(400).json({ error: 'disease, sector and location are required' });
    }

    const cases = cleanCases(req.body.cases);
    const mortality = cleanCount(req.body.mortality);
    const latitude = cleanCoord(req.body.latitude, -90, 90);
    const longitude = cleanCoord(req.body.longitude, -180, 180);
    const date = cleanDate(req.body.date);

    if (!cases) return res.status(400).json({ error: 'cases must be a number from 1 to 500' });
    if (mortality === null) return res.status(400).json({ error: 'mortality must be a number from 0 to 500' });
    if (latitude === null) return res.status(400).json({ error: 'latitude must be between -90 and 90' });
    if (longitude === null) return res.status(400).json({ error: 'longitude must be between -180 and 180' });
    if (date === null) return res.status(400).json({ error: 'date must be a valid date' });

    const report = withReportQuality({
      disease,
      sector,
      location,
      cases,
      latitude,
      longitude,
      species: cleanOptionalText(req.body.species, 60),
      symptoms: cleanOptionalText(req.body.symptoms, 240),
      mortality,
      vaccinationStatus: cleanEnum(req.body.vaccinationStatus, new Set(['unknown', 'vaccinated', 'partial', 'unvaccinated']), 'unknown'),
      confirmationStatus: cleanEnum(req.body.confirmationStatus, new Set(['suspected', 'lab_confirmed']), 'suspected'),
      farmId: cleanOptionalText(req.body.farmId, 80),
      block: cleanOptionalText(req.body.block, 80),
      date,
    }, {
      sourceType: 'manual',
      sourceName: 'Manual report form',
      sourceUploadedBy: req.user.username,
      sourceUploadedAt: new Date(),
    });

    const saved = await Report.create(report);
    await writeAudit('reports.manual.created', req.user, {
      reportId: saved._id,
      location: saved.location,
      sector: saved.sector,
      dataQualityScore: saved.dataQualityScore,
    }, req);
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
