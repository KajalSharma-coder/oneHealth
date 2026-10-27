const mongoose = require('mongoose');

const datasetSchema = new mongoose.Schema({
  datasetId: { type: String, required: true, unique: true, index: true },
  fileName: { type: String, required: true, trim: true, maxlength: 255 },
  contentHash: { type: String, required: true, unique: true, index: true },
  sourceDataset: { type: String, trim: true, maxlength: 120 },
  status: { type: String, enum: ['importing', 'ready', 'failed'], required: true, default: 'importing', index: true },
  importedAt: { type: Date, default: Date.now, index: true },
  rowCount: { type: Number, default: 0 },
  importedRows: { type: Number, default: 0 },
  skippedRows: { type: Number, default: 0 },
  rejectedRows: { type: Number, default: 0 },
  dateMin: Date,
  dateMax: Date,
  headers: [{ type: String, trim: true }],
  error: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true });

module.exports = mongoose.model('Dataset', datasetSchema);
