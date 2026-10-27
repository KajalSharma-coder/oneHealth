const FLAG_WEIGHTS = {
  missing_coordinates: 10,
  missing_species: 14,
  unknown_vaccination: 10,
  lab_pending: 8,
  missing_farm_or_holding: 8,
  missing_block_or_village: 6,
  stale_report: 12,
  mortality_exceeds_cases: 18,
  missing_source: 10,
};

const SOURCE_CONFIDENCE = {
  manual: 82,
  csv: 78,
  seed: 72,
  demo: 65,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hasCoord = (value) => Number.isFinite(Number(value));

function assessReportQuality(report) {
  const flags = [];
  const sector = report.sector || report.sec;
  const cases = Number(report.cases ?? report.n ?? 0);
  const mortality = Number(report.mortality || 0);
  const date = report.date ? new Date(report.date) : null;
  const sourceType = report.sourceType || report.source || '';

  if (!hasCoord(report.latitude ?? report.lat) || !hasCoord(report.longitude ?? report.lon)) flags.push('missing_coordinates');
  if (!sourceType) flags.push('missing_source');
  if (date && !Number.isNaN(date.getTime()) && Date.now() - date.getTime() > 21 * 24 * 60 * 60 * 1000) flags.push('stale_report');

  if (sector === 'animal') {
    if (!report.species) flags.push('missing_species');
    if (!report.vaccinationStatus || report.vaccinationStatus === 'unknown') flags.push('unknown_vaccination');
    if (report.confirmationStatus !== 'lab_confirmed') flags.push('lab_pending');
    if (!report.farmId) flags.push('missing_farm_or_holding');
    if (!report.block) flags.push('missing_block_or_village');
    if (mortality > cases) flags.push('mortality_exceeds_cases');
  }

  const penalty = flags.reduce((total, flag) => total + (FLAG_WEIGHTS[flag] || 5), 0);
  const sourceConfidence = SOURCE_CONFIDENCE[sourceType] || 70;
  const score = clamp(Math.round((100 - penalty) * 0.72 + sourceConfidence * 0.28), 0, 100);

  return {
    dataQualityScore: score,
    qualityFlags: flags,
  };
}

function withReportQuality(report, provenance = {}) {
  const next = {
    ...report,
    datasetId: provenance.datasetId || report.datasetId,
    sourceType: provenance.sourceType || report.sourceType || 'manual',
    sourceName: provenance.sourceName || report.sourceName,
    sourceUploadedBy: provenance.sourceUploadedBy || report.sourceUploadedBy,
    sourceUploadedAt: provenance.sourceUploadedAt || report.sourceUploadedAt || new Date(),
  };
  return {
    ...next,
    ...assessReportQuality(next),
  };
}

module.exports = { assessReportQuality, withReportQuality };
