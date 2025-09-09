const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');  // Global import for JWT verification

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { 
    origin: '*',  // Allow React Native/any origin
    methods: ['GET', 'POST']
  } 
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

// Socket.io Authentication Middleware (verifies token and sets socket.userId)
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('No token provided - disconnecting socket');
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;  // Or decoded._id if using _id in your JWT payload
    console.log(`Socket auth successful for user: ${socket.userId}`);
    next();
  } catch (err) {
    console.error('Invalid token during socket auth:', err.message);
    next(new Error('Invalid token'));
  }
});

// Global map to track online users (userId -> socket)
const onlineUsers = new Map();

// Socket.io Connection Handler (existing chat + new call events)
io.on('connection', (socket) => {
  // Middleware already set socket.userId - no re-verification needed
  if (!socket.userId) {
    console.error('No userId after auth - disconnecting');
    socket.disconnect(true);
    return;
  }

  // Add user to online list
  onlineUsers.set(socket.userId, socket);
  console.log(`User ${socket.userId} connected - Total online: ${onlineUsers.size}`);

  // Emit to all clients: This user is now online
  io.emit('userOnline', { userId: socket.userId });

  // Handle joinChat (existing)
  socket.on('joinChat', (otherUserId) => {
    if (!otherUserId) return;
    const room = `chat_${[socket.userId, otherUserId].sort().join('_')}`;
    socket.join(room);
    console.log(`User ${socket.userId} joined chat with ${otherUserId} (room: ${room})`);
  });

  // Handle sending message (existing + complete MongoDB save)
  socket.on('sendMessage', async (data) => {
    const { to, encryptedContent } = data;
    if (!to || !encryptedContent) {
      console.error('Invalid sendMessage data:', data);
      return socket.emit('error', { message: 'Invalid message data' });
    }

    try {
      const Message = require('./models/Message');  // Assume your Message model
      const newMessage = new Message({
        from: socket.userId,
        to,
        encryptedContent,
        timestamp: new Date()
      });
      await newMessage.save();
      console.log(`Message saved from ${socket.userId} to ${to}`);

      // Broadcast to receiver's room
      const room = `chat_${[socket.userId, to].sort().join('_')}`;
      io.to(room).emit('receiveMessage', {
        from: socket.userId,
        to,
        encryptedContent,
        timestamp: newMessage.timestamp
      });
    } catch (err) {
      console.error('Error saving message:', err);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // New: Handle request for current online users (initial load)
  socket.on('getOnlineUsers', () => {
    const onlineList = Array.from(onlineUsers.keys());  // Array of userIds
    socket.emit('onlineUsersList', { onlineUsers: onlineList });
    console.log(`Sent online list to ${socket.userId}:`, onlineList);
  });

  // New: Initiate call (voice/video) - emit incomingCall to receiver if online
  socket.on('initiateCall', (data) => {
    const { to, roomId, isVideo } = data;  // to = receiver userId, roomId = unique call ID, isVideo = boolean
    if (!to || !roomId) {
      console.error('Invalid initiateCall data:', data);
      return socket.emit('callFailed', { message: 'Invalid call data' });
    }

    const receiverSocket = onlineUsers.get(to);
    if (receiverSocket) {
      receiverSocket.emit('incomingCall', {
        from: socket.userId,  // Caller userId
        roomId,
        isVideo,
        callerName: 'Caller'  // Optional: Fetch from DB or pass from frontend
      });
      console.log(`Call initiated from ${socket.userId} to ${to}, room: ${roomId}, video: ${isVideo}`);
    } else {
      console.log(`Receiver ${to} is offline - call failed`);
      socket.emit('callFailed', { message: 'Receiver is offline or unavailable' });
    }
  });

  // New: Accept call - notify caller
  socket.on('acceptCall', (data) => {
    const { to, roomId } = data;  // to = caller userId
    if (!to || !roomId) {
      console.error('Invalid acceptCall data:', data);
      return;
    }

    const callerSocket = onlineUsers.get(to);
    if (callerSocket) {
      callerSocket.emit('callAccepted', { roomId });
      console.log(`Call accepted by ${socket.userId} in room ${roomId} - notified caller ${to}`);
    } else {
      console.log(`Caller ${to} not found for accept notification`);
    }
  });

  // New: Reject call - notify caller
  socket.on('rejectCall', (data) => {
    const { to, roomId } = data;  // to = caller userId
    if (!to || !roomId) {
      console.error('Invalid rejectCall data:', data);
      return;
    }

    const callerSocket = onlineUsers.get(to);
    if (callerSocket) {
      callerSocket.emit('callRejected', { roomId });
      console.log(`Call rejected by ${socket.userId} in room ${roomId} - notified caller ${to}`);
    } else {
      console.log(`Caller ${to} not found for reject notification`);
    }
  });

  // New: End call - notify the other user (if known; simplified for 1v1)
  socket.on('endCall', (data) => {
    const { roomId, otherUserId } = data;  // Optional: Pass otherUserId from frontend for notification
    if (!roomId) {
      console.error('Invalid endCall data:', data);
      return;
    }

    console.log(`Call ended by ${socket.userId} in room ${roomId}`);
    
    // If otherUserId provided, notify them
    if (otherUserId) {
      const otherSocket = onlineUsers.get(otherUserId);
      if (otherSocket) {
        otherSocket.emit('endCall', { roomId });
        console.log(`End call notified to ${otherUserId} in room ${roomId}`);
      }
    }
    // Else, frontend handles it (e.g., via navigation)
  });

  // Disconnect handler (existing + online status)
  socket.on('disconnect', (reason) => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected (${reason}) - Total online: ${onlineUsers.size}`);
      // Emit to all clients: This user is now offline
      io.emit('userOffline', { userId: socket.userId });
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const dotenv = require('dotenv');
// const http = require('http');
// const socketIo = require('socket.io');
// const jwt = require('jsonwebtoken');  // Added: Global import to fix "jwt is not defined"

// // Routes
// const authRoutes = require('./routes/auth');
// const userRoutes = require('./routes/users');
// const messageRoutes = require('./routes/messages');

// dotenv.config();

// const app = express();
// const server = http.createServer(app);
// const io = socketIo(server, { 
//   cors: { 
//     origin: '*',  // Allow React Native/any origin
//     methods: ['GET', 'POST']
//   } 
// });

// // Middleware
// app.use(cors());
// app.use(express.json());

// // MongoDB Connection
// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB connected'))
//   .catch(err => console.error('MongoDB connection error:', err));

// // Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/messages', messageRoutes);

// // Socket.io Authentication Middleware (existing - verifies token and sets socket.userId)
// io.use((socket, next) => {
//   const token = socket.handshake.auth.token;
//   if (!token) {
//     console.log('No token provided - disconnecting socket');
//     return next(new Error('Authentication error'));
//   }
//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     socket.userId = decoded.id;  // Or decoded._id if using _id
//     console.log(`Socket auth successful for user: ${socket.userId}`);
//     next();
//   } catch (err) {
//     console.error('Invalid token during socket auth:', err.message);
//     next(new Error('Invalid token'));
//   }
// });

// // Global map to track online users (userId -> socket)
// const onlineUsers = new Map();

// // Socket.io Connection Handler (merged: original + online status)
// io.on('connection', (socket) => {
//   // Middleware already set socket.userId - no re-verification needed
//   if (!socket.userId) {
//     console.error('No userId after auth - disconnecting');
//     socket.disconnect(true);
//     return;
//   }

//   // Add user to online list
//   onlineUsers.set(socket.userId, socket);
//   console.log(`User ${socket.userId} connected - Total online: ${onlineUsers.size}`);

//   // Emit to all clients: This user is now online
//   io.emit('userOnline', { userId: socket.userId });

//   // Handle joinChat (existing)
//   socket.on('joinChat', (otherUserId) => {
//     if (!otherUserId) return;
//     const room = `chat_${[socket.userId, otherUserId].sort().join('_')}`;
//     socket.join(room);
//     console.log(`User ${socket.userId} joined chat with ${otherUserId} (room: ${room})`);
//   });

//   // Handle sending message (existing + complete MongoDB save)
//   socket.on('sendMessage', async (data) => {
//     const { to, encryptedContent } = data;
//     if (!to || !encryptedContent) {
//       console.error('Invalid sendMessage data:', data);
//       return socket.emit('error', { message: 'Invalid message data' });
//     }

//     try {
//       const Message = require('./models/Message');  // Assume your Message model
//       const newMessage = new Message({
//         from: socket.userId,
//         to,
//         encryptedContent,
//         timestamp: new Date()
//       });
//       await newMessage.save();
//       console.log(`Message saved from ${socket.userId} to ${to}`);

//       // Broadcast to receiver's room
//       const room = `chat_${[socket.userId, to].sort().join('_')}`;
//       io.to(room).emit('receiveMessage', {
//         from: socket.userId,
//         to,
//         encryptedContent,
//         timestamp: newMessage.timestamp
//       });
//     } catch (err) {
//       console.error('Error saving message:', err);
//       socket.emit('error', { message: 'Failed to send message' });
//     }
//   });

//   // New: Handle request for current online users (initial load)
//   socket.on('getOnlineUsers', () => {
//     const onlineList = Array.from(onlineUsers.keys());  // Array of userIds
//     socket.emit('onlineUsersList', { onlineUsers: onlineList });
//     console.log(`Sent online list to ${socket.userId}:`, onlineList);
//   });

//   // Disconnect handler (existing + online status)
//   socket.on('disconnect', (reason) => {
//     if (socket.userId) {
//       onlineUsers.delete(socket.userId);
//       console.log(`User ${socket.userId} disconnected (${reason}) - Total online: ${onlineUsers.size}`);
//       // Emit to all clients: This user is now offline
//       io.emit('userOffline', { userId: socket.userId });
//     }
//   });
// });

// // Start server
// const PORT = process.env.PORT || 5000;
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });