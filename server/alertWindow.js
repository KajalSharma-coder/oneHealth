const DAY = 24 * 60 * 60 * 1000;

const datasetMatches = (row, datasetId) => datasetId?.startsWith('legacy:')
  ? !row.datasetId && row.sourceName === decodeURIComponent(datasetId.slice('legacy:'.length))
  : !datasetId || row.datasetId === datasetId;

function selectAnalysisWindow(rows, datasetId, fallbackDate = new Date()) {
  const selected = rows.filter((row) => datasetMatches(row, datasetId));
  const latest = selected.reduce((max, row) => {
    const date = new Date(row.date);
    return !Number.isNaN(date.getTime()) && (!max || date > max) ? date : max;
  }, null) || fallbackDate;
  const start = new Date(latest.getTime() - 29 * DAY);
  return { reports: selected.filter((row) => new Date(row.date) >= start && new Date(row.date) <= latest), referenceDate: latest };
}

module.exports = { selectAnalysisWindow };
