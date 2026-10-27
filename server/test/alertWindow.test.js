const test = require('node:test');
const assert = require('node:assert/strict');
const { selectAnalysisWindow } = require('../alertWindow');

test('historical alert windows use each selected dataset latest date', () => {
  const rows = [
    { datasetId: 'old', date: new Date('2021-01-01'), location: 'Jaipur' },
    { datasetId: 'old', date: new Date('2021-01-30'), location: 'Jaipur' },
    { datasetId: 'new', date: new Date('2026-10-01'), location: 'Delhi' },
  ];
  const result = selectAnalysisWindow(rows, 'old');
  assert.equal(result.referenceDate.toISOString(), '2021-01-30T00:00:00.000Z');
  assert.equal(result.reports.length, 2);
});

test('analysis windows never mix records from another dataset', () => {
  const result = selectAnalysisWindow([
    { datasetId: 'a', date: new Date('2021-01-30') },
    { datasetId: 'b', date: new Date('2021-01-30') },
  ], 'a');
  assert.deepEqual(result.reports.map((row) => row.datasetId), ['a']);
});
