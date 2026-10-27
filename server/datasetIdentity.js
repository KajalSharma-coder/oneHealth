const crypto = require('crypto');

const datasetIdForBuffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const legacyDatasetId = (sourceName) => `legacy:${encodeURIComponent(String(sourceName || 'unknown'))}`;

module.exports = { datasetIdForBuffer, legacyDatasetId };
