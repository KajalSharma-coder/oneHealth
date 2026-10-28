const ALL_DATASETS = 'all';

const isAllDatasets = (datasetId) => !datasetId || datasetId === ALL_DATASETS;

function sharedReportFilter(readyDatasetIds) {
  return {
    $or: [
      ...(readyDatasetIds.length ? [{ datasetId: { $in: readyDatasetIds } }] : []),
      { datasetId: { $exists: false }, sourceType: 'csv' },
      { datasetId: { $exists: false }, sourceType: { $ne: 'csv' } },
    ],
  };
}

function filterSharedReports(rows, readyDatasetIds) {
  const ready = new Set(readyDatasetIds);
  return rows.filter((row) =>
    (row.datasetId && ready.has(row.datasetId))
      || (!row.datasetId && row.sourceType === 'csv')
      || (!row.datasetId && row.sourceType !== 'csv'));
}

function sharedRecordKey(row) {
  if (row.recordFingerprint) return `fingerprint:${row.recordFingerprint}`;
  return [row.date || '', row.location || '', row.sector || '', row.disease || '', row.cases ?? '', row.latitude ?? '', row.longitude ?? '', row.temperatureCelsius ?? '', row.precipitationMm ?? ''].join('|');
}

function dedupeSharedReports(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = sharedRecordKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { ALL_DATASETS, isAllDatasets, sharedReportFilter, filterSharedReports, dedupeSharedReports };
