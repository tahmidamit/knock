const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  participantUsernames: [{
    type: String,
    required: true
  }],
  chatId: {
    type: String,
    unique: true,
    required: true
  },
  lastMessage: {
    content: String,
    sender: String,
    timestamp: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Chat', chatSchema);
