const mongoose = require('mongoose');

const alertValidationSchema = new mongoose.Schema({
  location: { type: String, required: true, unique: true, trim: true, index: true },
  status: { type: String, required: true, enum: ['new', 'acknowledged', 'investigating', 'resolved', 'dismissed', 'validated', 'review'] },
  responseStatus: { type: String, enum: ['new', 'investigating', 'sample_collected', 'contained', 'resolved'], default: 'new' },
  note: { type: String, trim: true, maxlength: 240, default: '' },
  by: { type: String, required: true, trim: true, lowercase: true },
  role: { type: String, required: true, trim: true },
  at: { type: Date, default: Date.now },
  responseUpdatedAt: { type: Date },
  history: [{
    status: { type: String, trim: true },
    by: { type: String, trim: true },
    role: { type: String, trim: true },
    at: { type: Date },
    note: { type: String, trim: true, maxlength: 240 },
  }],
}, { timestamps: true });

module.exports = mongoose.model('AlertValidation', alertValidationSchema);
