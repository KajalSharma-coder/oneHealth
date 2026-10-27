const test = require('node:test');
const assert = require('node:assert/strict');
const { ALL_DATASETS, filterSharedReports, sharedReportFilter } = require('../datasetScope');

test('shared scope combines every ready dataset and legacy CSV rows across sectors', () => {
  const rows = [
    { datasetId: 'admin-a', sector: 'human' },
    { datasetId: 'admin-b', sector: 'animal' },
    { datasetId: 'admin-b', sector: 'environment' },
    { datasetId: 'failed-import', sector: 'human' },
    { sourceType: 'csv', sourceName: 'legacy.csv', sector: 'environment' },
  ];
  const combined = filterSharedReports(rows, ['admin-a', 'admin-b']);
  assert.equal(ALL_DATASETS, 'all');
  assert.equal(combined.length, 4);
  assert.deepEqual(new Set(combined.map((row) => row.sector)), new Set(['human', 'animal', 'environment']));
  assert.ok(!combined.some((row) => row.datasetId === 'failed-import'));
});

test('shared Mongo filter scopes reports to ready IDs and legacy imports without merging provenance', () => {
  const filter = sharedReportFilter(['admin-a', 'admin-b']);
  assert.deepEqual(filter.$or, [
    { datasetId: { $in: ['admin-a', 'admin-b'] } },
    { datasetId: { $exists: false }, sourceType: 'csv' },
    { datasetId: { $exists: false }, sourceType: { $ne: 'csv' } },
  ]);
});
