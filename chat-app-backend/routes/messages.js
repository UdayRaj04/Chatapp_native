const express = require('express');
const Message = require('../models/Message');
const authMiddleware = require('../middleware/auth');  // Import from new middleware file
const router = express.Router();

// Get messages between two users
router.get('/:otherUserId', authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { from: req.userId, to: req.params.otherUserId },
        { from: req.params.otherUserId, to: req.userId }
      ]
    }).sort('timestamp').populate('from to', 'username');
    
    // Map response for frontend (use _id as from/to, send encryptedContent)
    const formattedMessages = messages.map(m => ({
      from: m.from._id.toString(),
      to: m.to._id.toString(),
      encryptedContent: m.encryptedContent,
      timestamp: m.timestamp
    }));
    
    res.json(formattedMessages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;