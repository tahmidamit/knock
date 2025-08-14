const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true,
    index: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderUsername: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file'],
    default: 'text'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient querying
messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
