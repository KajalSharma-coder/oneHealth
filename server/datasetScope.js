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

module.exports = { ALL_DATASETS, isAllDatasets, sharedReportFilter, filterSharedReports };
