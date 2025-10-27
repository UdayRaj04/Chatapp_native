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

app.get('/health', (req, res) => {
  res.json({ ok: true });
  console.log('Health check OK');
});


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

  // Updated: Call Signaling Events (WebRTC) - Use socket.userId as 'from'
  // initiateCall: Caller starts call, notifies callee if online
  socket.on('initiateCall', (data) => {
    const { to, type, roomId } = data;
    if (!roomId || !to || (type !== 'audio' && type !== 'video')) {
      console.error('Invalid initiateCall data:', data);
      return socket.emit('callError', { message: 'Invalid call data' });
    }
    const from = socket.userId;
    console.log(`📞 Call initiated by ${from} to ${to} (type: ${type}, room: ${roomId})`);
    
    // Caller joins room
    socket.join(roomId);
    
    // Direct emit to recipient if online
    const recipientSocket = onlineUsers.get(to);
    if (recipientSocket) {
      console.log(`✅ Emitting incomingCall to online recipient ${to}`);
      recipientSocket.emit('incomingCall', { from, type, roomId });
    } else {
      console.log(`❌ Recipient ${to} offline - notify caller`);
      socket.emit('callError', { message: 'Recipient is offline' });
    }
    
    // Confirm to caller (even if recipient offline)
    socket.emit('callInitiated', { roomId });
  });

  // acceptCall: Callee accepts, notifies caller
  socket.on('acceptCall', (data) => {
    const { roomId } = data;
    if (!roomId) {
      console.error('Invalid acceptCall data:', data);
      return socket.emit('callError', { message: 'Invalid accept data' });
    }
    const from = socket.userId; // Acceptor
    console.log(`Call accepted by ${from} in room ${roomId}`);
    
    // Acceptor joins room for signaling
    socket.join(roomId);
    
    // Notify caller via room
    socket.to(roomId).emit('callAccepted', { roomId });
  });

  // New: readyForOffer passthrough - forward from recipient to caller after accept
  socket.on('readyForOffer', (data) => {
    const { roomId } = data;
    if (!roomId) return console.error('Invalid readyForOffer data');
    console.log(`Recipient ${socket.userId} ready in room ${roomId} - forwarding to caller`);
    socket.to(roomId).emit('readyForOffer', data); // Forward to caller in room
  });

  // rejectCall: Callee rejects, notifies caller
  socket.on('rejectCall', (data) => {
    const { roomId, reason = 'declined' } = data;
    if (!roomId) {
      console.error('Invalid rejectCall data:', data);
      return;
    }
    const from = socket.userId  // Rejector
    console.log(`Call rejected by ${from} in room ${roomId} (reason: ${reason})`);
    
    // Notify caller
    const [callerId, calleeId] = roomId.split('_');
    const callerSocket = onlineUsers.get(callerId === from ? calleeId : callerId);
    if (callerSocket) {
      callerSocket.emit('callRejected', { roomId, reason });
    }
  });

  // endCall: End call, notify other party
  socket.on('endCall', (data) => {
    const { roomId } = data;
    if (!roomId) {
      console.error('Invalid endCall data:', data);
      return;
    }
    const from = socket.userId;
    console.log(`Call ended by ${from} in room ${roomId}`);
    
    // Broadcast to room
    io.to(roomId).emit('callEnded', { roomId, reason: 'ended' });  // io.to for all in room
    // Leave room
    socket.leave(roomId);
  });

  // WebRTC Signaling: Relay SDP offers/answers and ICE candidates via room or direct
  socket.on('offer', (data) => {
    const { roomId, offer } = data;
    if (!roomId || !offer) {
      console.error('Invalid offer data:', data);
      return socket.emit('callError', { message: 'Invalid offer' });
    }
    console.log(`📋 Offer received in room ${roomId} from ${socket.userId} (type: ${offer.type})`);
    socket.to(roomId).emit('offer', { 
      from: socket.userId, 
      offer, 
      roomId 
    });
  });

  // Enhanced answer handler with logging and sdpType
  socket.on('answer', (data) => {
    const { roomId, answer } = data;
    if (!roomId || !answer) {
      console.error('Invalid answer data:', data);
      return socket.emit('callError', { message: 'Invalid answer' });
    }
    console.log(`📋 Answer received in room ${roomId} from ${socket.userId} (type: ${answer.type})`);
    socket.to(roomId).emit('answer', { 
      from: socket.userId, 
      answer, 
      roomId 
    });
  });

  socket.on('ice-candidate', (data) => {
    const { roomId, candidate } = data;
    if (!roomId || !candidate) {
      console.error('Invalid ICE data:', data);
      return socket.emit('callError', { message: 'Invalid ICE candidate' });
    }
    console.log(`ICE candidate received in room ${roomId} from ${socket.userId} (type: ${candidate.type})`);
    socket.to(roomId).emit('ice-candidate', { 
      from: socket.userId, 
      candidate, 
      roomId 
    });
  });

  // Disconnect handler (existing + online status + call cleanup)
  socket.on('disconnect', (reason) => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected (${reason}) - Total online: ${onlineUsers.size}`);
      // Emit to all clients: This user is now offline
      io.emit('userOffline', { userId: socket.userId });
      
      // Cleanup any active calls involving this user
      // Iterate through rooms if needed, but since direct, emit endCall to known peers if you track
      // For simplicity: Assume frontend handles end on disconnect
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});