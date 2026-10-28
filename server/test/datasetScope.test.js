const test = require('node:test');
const assert = require('node:assert/strict');
const { ALL_DATASETS, filterSharedReports, sharedReportFilter, dedupeSharedReports } = require('../datasetScope');

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

test('shared scope deduplicates repeated records while retaining the first provenance row', () => {
  const rows = [
    { recordFingerprint: 'same', datasetId: 'admin-a', sourceName: 'a.csv' },
    { recordFingerprint: 'same', datasetId: 'admin-b', sourceName: 'b.csv' },
    { recordFingerprint: 'different', datasetId: 'admin-b', sourceName: 'b.csv' },
  ];
  const result = dedupeSharedReports(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].sourceName, 'a.csv');
});
