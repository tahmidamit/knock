const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fromUsername: {
    type: String,
    required: true
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  toUsername: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  message: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate invites
inviteSchema.index({ from: 1, to: 1 }, { unique: true });

module.exports = mongoose.model('Invite', inviteSchema);
