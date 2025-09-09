const express = require('express');
const jwt = require('jsonwebtoken');  // Still needed if you use jwt elsewhere, but not for middleware
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');  // Import from new middleware file
const router = express.Router();

// Get all users (for chat list) - Now uses imported authMiddleware
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Note: Fixed select to use '_id' instead of 'id' for consistency with MongoDB
    const users = await User.find({ _id: { $ne: req.userId } }).select('_id username email');
    // Map _id to id for frontend compatibility
    // const formattedUsers = users.map(user => ({
    //   _id: user._id,
    //   id: user._id,  // Alias for frontend
    //   username: user.username,
    //   email: user.email
    // }));
    // In the map:
const formattedUsers = users.map(user => ({
  _id: user._id.toString(),  // Ensure string
  id: user._id.toString(),   // Alias as string
  username: user.username,
  email: user.email
}));
    res.json(formattedUsers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;  // Export only the router now