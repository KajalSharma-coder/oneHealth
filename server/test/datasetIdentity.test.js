const test = require('node:test');
const assert = require('node:assert/strict');
const { datasetIdForBuffer, legacyDatasetId } = require('../datasetIdentity');

test('dataset IDs are stable for identical bytes and distinct for different datasets', () => {
  const first = Buffer.from('date,disease,cases\n2022-01-01,Dengue,2');
  const second = Buffer.from('date,disease,cases\n2022-01-02,Dengue,2');
  assert.equal(datasetIdForBuffer(first), datasetIdForBuffer(Buffer.from(first)));
  assert.notEqual(datasetIdForBuffer(first), datasetIdForBuffer(second));
  assert.match(legacyDatasetId('sample.csv'), /^legacy:/);
});
