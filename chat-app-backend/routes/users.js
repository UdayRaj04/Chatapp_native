// const express = require('express');
// const jwt = require('jsonwebtoken');  // Still needed if you use jwt elsewhere, but not for middleware
// const User = require('../models/User');
// const authMiddleware = require('../middleware/auth');  // Import from new middleware file
// const router = express.Router();

// // Get all users (for chat list) - Now uses imported authMiddleware
// router.get('/', authMiddleware, async (req, res) => {
//   try {
//     // Note: Fixed select to use '_id' instead of 'id' for consistency with MongoDB
//     const users = await User.find({ _id: { $ne: req.userId } }).select('_id username email');
//     // Map _id to id for frontend compatibility
//     // const formattedUsers = users.map(user => ({
//     //   _id: user._id,
//     //   id: user._id,  // Alias for frontend
//     //   username: user.username,
//     //   email: user.email
//     // }));
//     // In the map:
// const formattedUsers = users.map(user => ({
//   _id: user._id.toString(),  // Ensure string
//   id: user._id.toString(),   // Alias as string
//   username: user.username,
//   email: user.email
// }));
//     res.json(formattedUsers);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;  // Export only the router now
const express = require('express');
const path = require('path');  // New: For file paths
const multer = require('multer');  // New: For file upload handling
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// New: Multer setup for avatar uploads (saves to /uploads folder)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');  // Create this folder
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },  // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed'), false);
    }
  },
});

// GET /api/users - Get all users (now includes avatar_url)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } }).select('_id username email bio insta_username avatar_url');
    const formattedUsers = users.map(user => ({
      _id: user._id.toString(),
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      bio: user.bio || '',
      insta_username: user.insta_username || '',
      avatar_url: user.avatar_url || '',  // New: Include avatar
    }));
    console.log(`Fetched ${formattedUsers.length} users for user ${req.userId}`);
    res.json(formattedUsers);
  } catch (err) {
    console.error('Get users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users - Update profile (now includes avatar_url if sent)
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { username, bio, insta_username, avatar_url } = req.body;  // New: Allow avatar_url update (from upload)

    // Validation (existing + avatar)
    if (username && (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username))) {
      return res.status(400).json({ error: 'Username must be 3-30 characters, alphanumeric + underscores only' });
    }
    if (bio && bio.length > 100) {
      return res.status(400).json({ error: 'Bio must be 100 characters or less' });
    }
    if (insta_username && (insta_username.length > 30 || !/^[a-zA-Z0-9_.]+$/.test(insta_username))) {
      return res.status(400).json({ error: 'Instagram username must be 30 characters or less, alphanumeric + . or _ only' });
    }
    if (avatar_url && !avatar_url.startsWith('http') && !avatar_url.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid avatar URL' });
    }

    const updateData = {};
    if (username) updateData.username = username;
    if (bio !== undefined) updateData.bio = bio;
    if (insta_username !== undefined) updateData.insta_username = insta_username;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;  // New: Update avatar

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Unique username check (existing)
    if (username) {
      const existingUser = await User.findOne({ username, _id: { $ne: req.userId } });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, runValidators: true }
    ).select('_id username email bio insta_username avatar_url');

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const formattedUser = {
      _id: updatedUser._id.toString(),
      id: updatedUser._id.toString(),
      username: updatedUser.username,
      email: updatedUser.email,
      bio: updatedUser.bio || '',
      insta_username: updatedUser.insta_username || '',
      avatar_url: updatedUser.avatar_url || '',  // New: Include in response
    };

    console.log(`Profile updated for user ${req.userId}:`, formattedUser);
    res.json(formattedUser);
  } catch (err) {
    console.error('Update profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// New: POST /api/users/upload-avatar - Upload avatar image
router.post('/upload-avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const avatarPath = `/uploads/${req.file.filename}`;  // Relative path (serve via static)

    // Update user with avatar_url
    const updatedUser = await User.findByIdAndUpdate(
      req.userId,
      { avatar_url: avatarPath },
      { new: true }
    ).select('_id username email bio insta_username avatar_url');

    const formattedUser = {
      _id: updatedUser._id.toString(),
      id: updatedUser._id.toString(),
      username: updatedUser.username,
      email: updatedUser.email,
      bio: updatedUser.bio || '',
      insta_username: updatedUser.insta_username || '',
      avatar_url: avatarPath,  // Full path for frontend
    };

    console.log(`Avatar uploaded for user ${req.userId}: ${avatarPath}`);
    res.json({ success: true, user: formattedUser });
  } catch (err) {
    console.error('Upload avatar error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ... existing imports and routes (GET /, PUT /, POST /upload-avatar)

// New: GET /api/users/me - Get current user's full profile (for fresh load)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select('_id username email bio insta_username avatar_url');
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Format for frontend (string IDs)
    const formattedUser = {
      _id: currentUser._id.toString(),
      id: currentUser._id.toString(),
      username: currentUser.username,
      email: currentUser.email,
      bio: currentUser.bio || '',
      insta_username: currentUser.insta_username || '',
      avatar_url: currentUser.avatar_url || '',  // Includes uploaded pic path
    };

    console.log(`Fetched current user profile for ${req.userId}:`, formattedUser);
    res.json(formattedUser);
  } catch (err) {
    console.error('Get me error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// New: GET /api/users/:id - Get single other user's profile (for chat/search) - Authenticated
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === req.userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const otherUser = await User.findById(id).select('_id username bio insta_username avatar_url');  // No email/password
    if (!otherUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Format for frontend
    const formattedUser = {
      _id: otherUser._id.toString(),
      id: otherUser._id.toString(),
      username: otherUser.username,
      bio: otherUser.bio || '',
      insta_username: otherUser.insta_username || '',
      avatar_url: otherUser.avatar_url || '',  // For pic display
    };

    console.log(`Fetched other user profile for ${req.userId}:`, formattedUser.username);
    res.json(formattedUser);
  } catch (err) {
    console.error('Get single user error:', err.message);
    res.status(500).json({ error: err.message });
  }
});




module.exports = router;