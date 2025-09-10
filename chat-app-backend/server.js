const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');  // Added: Global import to fix "jwt is not defined"
const multer = require('multer');  // npm install multer

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

// New: Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

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

// Socket.io Authentication Middleware (existing - verifies token and sets socket.userId)
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log('No token provided - disconnecting socket');
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;  // Or decoded._id if using _id
    console.log(`Socket auth successful for user: ${socket.userId}`);
    next();
  } catch (err) {
    console.error('Invalid token during socket auth:', err.message);
    next(new Error('Invalid token'));
  }
});

// Global map to track online users (userId -> socket)
const onlineUsers = new Map();

// Socket.io Connection Handler (merged: original + online status + calling)
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

  // New: Call Signaling Events (WebRTC)
  socket.on('initiateCall', (data) => {
    const { from, to, type } = data;  // type: 'video' or 'audio'
    if (!from || !to || !type) {
      console.error('Invalid initiateCall data:', data);
      return socket.emit('error', { message: 'Invalid call data' });
    }
    console.log(`Call initiated from ${from} to ${to} (type: ${type})`);
    // Emit to target user (direct emit to their socket if online)
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      targetSocket.emit('incomingCall', {
        from,
        type,
      });
    } else {
      // Partner offline - notify caller
      socket.emit('callError', { message: 'Partner is offline' });
    }
  });

  socket.on('callOffer', (data) => {
    const { from, to, offer, type } = data;
    if (!from || !to || !offer || !type) {
      console.error('Invalid callOffer data:', data);
      return socket.emit('error', { message: 'Invalid offer data' });
    }
    console.log('Call offer from', from, 'to', to);
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      targetSocket.emit('callOffer', { from, offer, type });
    }
  });

  socket.on('callAnswer', (data) => {
    const { from, to, answer } = data;
    if (!from || !to || !answer) {
      console.error('Invalid callAnswer data:', data);
      return socket.emit('error', { message: 'Invalid answer data' });
    }
    console.log('Call answer from', from, 'to', to);
    const targetSocket = onlineUsers.get(from);
    if (targetSocket) {
      targetSocket.emit('callAnswer', { answer });
    }
  });

  socket.on('iceCandidate', (data) => {
    const { from, to, candidate } = data;
    if (!from || !to || !candidate) {
      console.error('Invalid iceCandidate data:', data);
      return socket.emit('error', { message: 'Invalid ICE data' });
    }
    console.log('ICE candidate from', from, 'to', to);
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      targetSocket.emit('iceCandidate', { candidate });
    }
  });

  socket.on('endCall', (data) => {
    const { from, to } = data;
    if (!from || !to) {
      console.error('Invalid endCall data:', data);
      return;
    }
    console.log('Call ended by', from);
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      targetSocket.emit('callEnded');
    }
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