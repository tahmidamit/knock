require('dotenv').config();
const { createServer } = require('https');
const fs = require('fs');
const path = require('path');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const connectDB = require('./config/database');
const { authenticate, generateToken, verifyAuthToken } = require('./middleware/auth');

// Import models
const User = require('./models/User');
const Invite = require('./models/Invite');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = 3000;
const socketPort = 3001; // Separate port for Socket.IO

// SSL options
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'cert.key')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.crt'))
};

// Connect to MongoDB
connectDB();

// Prepare Next.js app with explicit configuration
const app = next({ 
  dev, 
  hostname, 
  port,
  // Remove inline webpack config to avoid conflicts with next.config.ts
});
const handle = app.getRequestHandler();

// Store for active socket connections
const activeConnections = new Map(); // userId -> socketId

// Store for active calls
const activeCalls = new Map(); // callId -> { chatId, callerUserId, calleeUserId, status, timestamp }

// Store pending WebRTC offers for offline users
const pendingOffers = new Map(); // userId -> [{ offer, chatId, fromUserId, fromUsername, timestamp }]

// Helper function to notify user about call events
function notifyCallEvent(io, userId, event, data) {
  const socketId = activeConnections.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    return true;
  }
  return false;
}

// Helper function to generate unique call ID
function generateCallId(chatId) {
  return `call_${chatId}_${Date.now()}`;
}

app.prepare().then(() => {
  console.log('🚀 Next.js app prepared successfully');
  
  // Create HTTPS server
  const server = createServer(httpsOptions, async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      const { pathname } = parsedUrl;
      
      // Handle API routes first
      if (pathname.startsWith('/api/')) {
        await handleApiRoute(req, res, pathname);
        return;
      }
      
      // Handle static assets (CSS, JS, images, etc.) with proper content types
      if (pathname.startsWith('/_next/') || 
          pathname.startsWith('/static/') ||
          pathname.startsWith('/public/') ||
          pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
        // For static assets, set appropriate content type and cache headers
        if (pathname.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
        } else if (pathname.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
        } else if (pathname.endsWith('.map')) {
          res.setHeader('Content-Type', 'application/json');
        }
        
        // Add cache headers for static assets
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        
        handle(req, res, parsedUrl);
        return;
      }
      
      // Add security headers only for HTML pages
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      handle(req, res, parsedUrl);
    } catch (err) {
      console.error('❌ Error handling request:', err);
      console.error('Request URL:', req.url);
      console.error('Request method:', req.method);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal server error');
      }
    }
  });

  // Create separate HTTPS server for Socket.IO on different port
  const socketServer = createServer(httpsOptions);
  const io = new Server(socketServer, {
    cors: {
      origin: [
        `https://localhost:${port}`, 
        `https://127.0.0.1:${port}`,
        `https://192.168.0.101:${port}`, // Your current local IP
        `https://192.168.0.103:${port}`, // Your previous local IP (backup)
        /^https:\/\/192\.168\.\d+\.\d+:3000$/, // Any 192.168.x.x IP on port 3000
        /^https:\/\/10\.\d+\.\d+\.\d+:3000$/, // Any 10.x.x.x IP on port 3000
        /^https:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:3000$/ // Any 172.16-31.x.x IP on port 3000
      ],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Socket.IO middleware for authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = verifyAuthToken(token);
      if (!decoded) {
        return next(new Error('Invalid token'));
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.username = user.username;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Handle socket connections
  io.on('connection', async (socket) => {
    console.log(`User ${socket.username} (${socket.userId}) connected`);
    
    // Store the connection
    activeConnections.set(socket.userId, socket.id);

    // Join user to their personal room for private messages
    socket.join(`user_${socket.userId}`);

    // Broadcast that this user joined to all other connected users
    socket.broadcast.emit('user-joined', {
      username: socket.username,
      userId: socket.userId,
      isOnline: true
    });

    // Send current online users list to the newly connected user
    const onlineUsers = [];
    for (const [userId, socketId] of activeConnections.entries()) {
      if (userId !== socket.userId) { // Don't include the current user
        const socketInstance = io.sockets.sockets.get(socketId);
        if (socketInstance && socketInstance.username) {
          onlineUsers.push({
            username: socketInstance.username,
            userId: userId,
            isOnline: true
          });
        }
      }
    }
    socket.emit('online-users', onlineUsers);

    // Send any pending offers to the user
    if (pendingOffers.has(socket.userId)) {
      const userPendingOffers = pendingOffers.get(socket.userId);
      userPendingOffers.forEach(offerData => {
        socket.emit('webrtc-offer-received', offerData);
      });
      pendingOffers.delete(socket.userId);
    }

    // Handle requests for pending invites
    socket.on('get-pending-invites', async () => {
      try {
        const invites = await Invite.find({ 
          to: socket.userId,
          status: 'pending'
        }).populate('from', 'username');
        
        socket.emit('pending-invites', invites.map(invite => ({
          id: invite._id,
          from: invite.fromUsername,
          to: socket.username, // Current user is the recipient
          status: invite.status,
          timestamp: invite.createdAt
        })));
      } catch (error) {
        console.error('Error getting pending invites:', error);
      }
    });

    // Handle user search
    socket.on('search-users', async (searchTerm) => {
      try {
        if (!searchTerm || searchTerm.trim().length < 1) {
          socket.emit('search-results', []);
          return;
        }

        // Search for users by username (case-insensitive, partial match)
        const users = await User.find({
          username: { 
            $regex: searchTerm.trim(), 
            $options: 'i' 
          },
          _id: { $ne: socket.userId } // Exclude current user
        }).select('username').limit(10);

        // Format results and check online status
        const searchResults = users.map(user => {
          // Check if user is online by looking for them in activeConnections
          let isOnline = false;
          for (const [userId, socketId] of activeConnections.entries()) {
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance && socketInstance.username === user.username) {
              isOnline = true;
              break;
            }
          }
          
          return {
            username: user.username,
            status: isOnline ? 'online' : 'offline'
          };
        });

        console.log(`📋 Search results for "${searchTerm}":`, searchResults.map(u => u.username));
        socket.emit('search-results', searchResults);

      } catch (error) {
        console.error('Error searching users:', error);
        socket.emit('search-results', []);
      }
    });

    // Handle sending invites
    socket.on('send-invite', async (data) => {
      try {
        const { toUsername } = data;
        console.log(`📤 Invite request: ${socket.username} → ${toUsername}`);
        
        // Find the target user
        const toUser = await User.findOne({ username: toUsername });
        if (!toUser) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        // Check if invite already exists (in either direction)
        const existingInvite = await Invite.findOne({
          $or: [
            { from: socket.userId, to: toUser._id },
            { from: toUser._id, to: socket.userId }
          ],
          status: 'pending'
        });

        if (existingInvite) {
          console.log(`❌ Duplicate invite detected: ${existingInvite.fromUsername} → ${existingInvite.toUsername}`);
          socket.emit('error', { message: 'Invite already exists between these users' });
          return;
        }

        // Create new invite
        const invite = new Invite({
          from: socket.userId,
          fromUsername: socket.username,
          to: toUser._id,
          toUsername: toUser.username,
          status: 'pending'
        });

        await invite.save();

        // Notify the target user if they're online
        const targetSocket = Array.from(io.sockets.sockets.values())
          .find(s => s.userId === toUser._id.toString());
        
        if (targetSocket) {
          targetSocket.emit('new-invite', {
            id: invite._id,
            from: socket.username,
            to: toUser.username,
            status: 'pending',
            timestamp: invite.createdAt
          });
        }

        socket.emit('invite-sent', { toUsername });
        console.log(`Invite sent from ${socket.username} to ${toUsername}`);

      } catch (error) {
        console.error('Error sending invite:', error);
        
        // Handle duplicate invite error specifically
        if (error.code === 11000) {
          socket.emit('error', { message: 'Invite already exists between these users' });
        } else {
          socket.emit('error', { message: 'Failed to send invite' });
        }
      }
    });

    // Handle responding to invites
    socket.on('respond-invite', async (data) => {
      try {
        const { inviteId, response } = data;
        
        // Map client response to database enum values
        const statusMap = {
          'accept': 'accepted',
          'reject': 'rejected'
        };
        const dbStatus = statusMap[response] || response;
        
        // Find and update the invite
        const invite = await Invite.findById(inviteId);
        if (!invite) {
          socket.emit('error', { message: 'Invite not found' });
          return;
        }

        // Verify the user is the recipient
        if (invite.to.toString() !== socket.userId) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        invite.status = dbStatus;
        await invite.save();

        // If accepted, create a chat
        if (response === 'accept') {
          const chat = new Chat({
            participants: [invite.from, invite.to],
            participantUsernames: [invite.fromUsername, socket.username],
            chatId: `${invite.from}_${invite.to}_${Date.now()}`
          });
          await chat.save();

          // Notify both users about the new chat
          const fromSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === invite.from.toString());
          
          if (fromSocket) {
            fromSocket.emit('invite-accepted', { 
              chatId: chat._id,
              otherUser: socket.username,
              otherUserId: socket.userId
            });
          }

          socket.emit('invite-accepted', { 
            chatId: chat._id,
            otherUser: invite.fromUsername,
            otherUserId: invite.from
          });
        }

        // Remove the invite after response
        await Invite.findByIdAndDelete(inviteId);

        console.log(`Invite ${response} by ${socket.username}`);

      } catch (error) {
        console.error('Error responding to invite:', error);
        socket.emit('error', { message: 'Failed to respond to invite' });
      }
    });

    // Handle requests for active chats
    socket.on('get-active-chats', async () => {
      try {
        const chats = await Chat.find({ 
          participants: socket.userId 
        }).populate('participants', 'username');
        
        const activeChats = chats.map(chat => {
          const otherUser = chat.participants.find(p => p._id.toString() !== socket.userId);
          const isOtherUserOnline = activeConnections.has(otherUser._id.toString());
          
          return {
            chatId: chat._id,
            otherUser: otherUser.username,
            otherUserId: otherUser._id,
            lastMessage: null, // TODO: implement last message
            createdAt: chat.createdAt,
            isOtherUserOnline
          };
        });
        
        socket.emit('active-chats', activeChats);
      } catch (error) {
        console.error('Error getting active chats:', error);
      }
    });

    // Handle joining chat rooms
    socket.on('join-chat', async (chatId) => {
      try {
        // Verify user has access to this chat
        const chat = await Chat.findById(chatId).populate('participants', 'username');
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const isParticipant = chat.participants.some(p => p._id.toString() === socket.userId);
        if (!isParticipant) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        socket.join(`chat_${chatId}`);
        console.log(`User ${socket.username} joined chat ${chatId}`);

        // Send recent messages
        const messages = await Message.find({ chatId })
          .populate('senderId', 'username')
          .sort({ timestamp: -1 })
          .limit(50);

        socket.emit('chat-history', {
          chatId,
          messages: messages.reverse().map(msg => ({
            id: msg._id,
            content: msg.content,
            senderId: msg.senderId._id,
            senderUsername: msg.senderId.username,
            timestamp: msg.timestamp
          }))
        });

      } catch (error) {
        console.error('Error joining chat:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Handle leaving chat rooms
    socket.on('leave-chat', (chatId) => {
      socket.leave(`chat_${chatId}`);
      console.log(`User ${socket.username} left chat ${chatId}`);
    });

    // Handle text messages
    socket.on('send-message', async (data) => {
      try {
        const { chatId, content } = data;

        // Verify user has access to this chat
        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const isParticipant = chat.participants.includes(socket.userId);
        if (!isParticipant) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Create and save the message
        const message = new Message({
          chatId,
          senderId: socket.userId,
          content,
          timestamp: new Date()
        });

        await message.save();
        await message.populate('senderId', 'username');

        const messageData = {
          id: message._id,
          content: message.content,
          senderId: message.senderId._id,
          senderUsername: message.senderId.username,
          timestamp: message.timestamp
        };

        // Send to all participants in the chat
        io.to(`chat_${chatId}`).emit('message-received', messageData);

        console.log(`Message sent in chat ${chatId} by ${socket.username}`);

      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle WebRTC offer
    socket.on('webrtc-offer', async (data) => {
      try {
        const { targetUserId, offer, chatId } = data;
        
        console.log(`WebRTC offer from ${socket.username} to user ${targetUserId}`);
        
        const targetSocketId = activeConnections.get(targetUserId);
        const offerData = {
          offer,
          chatId,
          fromUserId: socket.userId,
          fromUsername: socket.username,
          timestamp: Date.now()
        };

        if (targetSocketId) {
          // User is online, send immediately
          io.to(targetSocketId).emit('webrtc-offer-received', offerData);
        } else {
          // User is offline, store for later
          if (!pendingOffers.has(targetUserId)) {
            pendingOffers.set(targetUserId, []);
          }
          pendingOffers.get(targetUserId).push(offerData);
          
          // Clean up old offers (older than 1 hour)
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          const userOffers = pendingOffers.get(targetUserId);
          const validOffers = userOffers.filter(offer => offer.timestamp > oneHourAgo);
          
          if (validOffers.length === 0) {
            pendingOffers.delete(targetUserId);
          } else {
            pendingOffers.set(targetUserId, validOffers);
          }
          
          console.log(`User ${targetUserId} is offline, offer stored`);
        }
      } catch (error) {
        console.error('Error handling WebRTC offer:', error);
        socket.emit('error', { message: 'Failed to send WebRTC offer' });
      }
    });

    // Handle WebRTC answer
    socket.on('webrtc-answer', (data) => {
      try {
        const { targetUserId, answer, chatId } = data;
        
        console.log(`WebRTC answer from ${socket.username} to user ${targetUserId} for chat ${chatId}`);
        
        const targetSocketId = activeConnections.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('webrtc-answer-received', {
            answer,
            chatId,
            fromUserId: socket.userId,
            fromUsername: socket.username
          });
        }
      } catch (error) {
        console.error('Error handling WebRTC answer:', error);
        socket.emit('error', { message: 'Failed to send WebRTC answer' });
      }
    });

    // Handle ICE candidates
    socket.on('webrtc-ice-candidate', (data) => {
      try {
        const { targetUserId, candidate, chatId } = data;
        
        console.log(`🧊 ICE candidate from ${socket.username} for chat ${chatId}`);
        
        const targetSocketId = activeConnections.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('webrtc-ice-candidate-received', {
            candidate,
            chatId,
            fromUserId: socket.userId,
            fromUsername: socket.username
          });
          console.log(`🧊 ICE candidate forwarded from ${socket.username} to ${targetUserId}`);
        } else {
          console.log(`⚠️ Target user ${targetUserId} not found for ICE candidate from ${socket.username}`);
        }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
        socket.emit('error', { message: 'Failed to send ICE candidate' });
      }
    });

    // Handle call rejection
    socket.on('webrtc-call-rejected', (data) => {
      try {
        const { targetUserId } = data;
        
        console.log(`Call rejected by ${socket.username} to user ${targetUserId}`);
        
        const targetSocketId = activeConnections.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('webrtc-call-rejected', {
            fromUserId: socket.userId,
            fromUsername: socket.username
          });
        }
      } catch (error) {
        console.error('Error handling call rejection:', error);
      }
    });

    // Handle call end
    socket.on('webrtc-call-ended', (data) => {
      try {
        const { targetUserId } = data;
        
        console.log(`Call ended by ${socket.username} to user ${targetUserId}`);
        
        const targetSocketId = activeConnections.get(targetUserId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('webrtc-call-ended', {
            fromUserId: socket.userId,
            fromUsername: socket.username
          });
        }
      } catch (error) {
        console.error('Error handling call end:', error);
      }
    });

    // === CALL INITIATION MECHANISM ===
    
    // Call initiation flow - Step 1: User initiates call
    socket.on('call-initiate', (data) => {
      const { targetUserId, chatId } = data;
      const fromUserId = socket.userId.toString();
      
      console.log(`📞 Call initiation from ${socket.username} to ${targetUserId} for chat ${chatId}`);
      
      if (!notifyCallEvent(io, targetUserId, 'test', {})) {
        socket.emit('call-failed', {
          targetUserId,
          chatId,
          reason: 'User is offline'
        });
        console.log(`❌ Call failed - user ${targetUserId} is offline`);
        return;
      }
      
      const callId = generateCallId(chatId);
      
      // Track the active call
      activeCalls.set(callId, {
        chatId,
        callerUserId: fromUserId,
        calleeUserId: targetUserId,
        status: 'pending',
        timestamp: Date.now()
      });
      
      // Send call notification to target user
      notifyCallEvent(io, targetUserId, 'incoming-call', {
        chatId,
        fromUserId,
        fromUsername: socket.username,
        callId
      });
      
      // Notify caller that call was initiated
      socket.emit('call-initiated', {
        targetUserId,
        chatId,
        callId,
        status: 'pending'
      });
      
      console.log(`📞 Call initiated for chat ${chatId} with ID ${callId}`);
    });

    // Call acceptance flow - Step 2: User accepts call
    socket.on('call-accept', (data) => {
      const { callId, chatId, fromUserId } = data;
      const acceptingUserId = socket.userId.toString();
      
      console.log(`✅ Call accepted by ${socket.username} for chat ${chatId} (${callId})`);
      
      // Update call status and reset timestamp for WebRTC negotiation
      const call = activeCalls.get(callId);
      if (call) {
        call.status = 'accepted';
        call.timestamp = Date.now(); // Reset timestamp for WebRTC timeout
        activeCalls.set(callId, call);
        console.log(`🔧 Call status updated to 'accepted' for ${callId}`);
      } else {
        console.log(`❌ Call not found in activeCalls: ${callId}`);
        console.log(`🔍 Current active calls:`, Array.from(activeCalls.keys()));
      }
      
      // Notify caller that call was accepted - now they can send WebRTC offer
      if (notifyCallEvent(io, fromUserId, 'call-accepted', {
        chatId,
        acceptedBy: socket.username,
        acceptedByUserId: acceptingUserId,
        callId
      })) {
        // Notify accepter to wait for offer
        socket.emit('call-accepted-wait-for-offer', {
          chatId,
          callId,
          callerUserId: fromUserId
        });
        
        console.log(`✅ Call acceptance confirmed for chat ${chatId} - WebRTC can begin`);
      } else {
        // Caller is no longer online
        socket.emit('call-failed', {
          chatId,
          reason: 'Caller is no longer online'
        });
        activeCalls.delete(callId);
        console.log(`❌ Call ${callId} failed - caller offline`);
      }
    });

    // Call rejection flow - Step 3: User rejects call
    socket.on('call-reject', (data) => {
      const { callId, chatId, fromUserId, reason = 'Call declined' } = data;
      
      console.log(`❌ Call rejected by ${socket.username} for chat ${chatId} (${callId})`);
      
      // Clean up the call
      activeCalls.delete(callId);
      
      // Notify caller that call was rejected
      notifyCallEvent(io, fromUserId, 'call-rejected', {
        chatId,
        rejectedBy: socket.username,
        reason,
        callId
      });
      
      console.log(`❌ Call rejection notified for chat ${chatId}: ${reason}`);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User ${socket.username} (${socket.userId}) disconnected`);
      
      // Clean up any active calls involving this user
      for (const [callId, call] of activeCalls.entries()) {
        if (call.callerUserId === socket.userId || call.calleeUserId === socket.userId) {
          console.log(`🔄 Cleaning up call ${callId} due to user ${socket.username} disconnecting`);
          
          // Notify the other party that the call ended
          const otherUserId = call.callerUserId === socket.userId ? call.calleeUserId : call.callerUserId;
          const otherSocketId = activeConnections.get(otherUserId);
          
          if (otherSocketId) {
            io.to(otherSocketId).emit('call-failed', {
              chatId: call.chatId,
              reason: `${socket.username} disconnected`,
              callId
            });
          }
          
          // Remove the call from active calls
          activeCalls.delete(callId);
        }
      }
      
      // Remove from active connections
      activeConnections.delete(socket.userId);
      
      // Broadcast that this user left to all other connected users
      socket.broadcast.emit('user-left', {
        username: socket.username,
        userId: socket.userId
      });
    });
  });

  // API routes are handled by the main request handler above

  // API route handler
  async function handleApiRoute(req, res, pathname) {
    res.setHeader('Content-Type', 'application/json');
    
    // Enable CORS for API routes - dynamically set origin based on request
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '');
    if (origin && (
      origin.includes('localhost:3000') || 
      origin.includes('127.0.0.1:3000') || 
      origin.includes('192.168.0.103:3000') ||
      /https:\/\/192\.168\.\d+\.\d+:3000/.test(origin) ||
      /https:\/\/10\.\d+\.\d+\.\d+:3000/.test(origin) ||
      /https:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+:3000/.test(origin)
    )) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }

    // Parse request body for POST/PUT requests
    if (req.method === 'POST' || req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          req.body = body ? JSON.parse(body) : {};
          await routeRequest(req, res, pathname);
        } catch (error) {
          console.error('Error parsing request body:', error);
          if (!res.headersSent) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        }
      });
    } else {
      await routeRequest(req, res, pathname);
    }
  }

  // Route dispatcher
  async function routeRequest(req, res, pathname) {
    try {
      switch (pathname) {
        case '/api/auth/register':
          await handleRegister(req, res);
          break;
        case '/api/auth/login':
          await handleLogin(req, res);
          break;
        case '/api/users':
          await handleGetUsers(req, res);
          break;
        case '/api/invites':
          await handleInvites(req, res);
          break;
        case '/api/chats':
          await handleChats(req, res);
          break;
        default:
          if (!res.headersSent) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
          }
      }
    } catch (error) {
      console.error('API Error:', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  }

  // Auth handlers
  async function handleRegister(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const { username, password } = req.body;

    if (!username || !password) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Username and password required' }));
      return;
    }

    try {
      // Check if user exists
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Username already exists' }));
        return;
      }

      // Create user
      const user = new User({ username, password });
      await user.save();

      // Generate token
      const token = generateToken(user._id);

      res.statusCode = 201;
      res.end(JSON.stringify({
        message: 'User created successfully',
        token,
        user: {
          id: user._id,
          username: user.username
        }
      }));
    } catch (error) {
      console.error('Registration error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to create user' }));
    }
  }

  async function handleLogin(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const { username, password } = req.body;

    if (!username || !password) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Username and password required' }));
      return;
    }

    try {
      const user = await User.findOne({ username });
      if (!user || !(await user.comparePassword(password))) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      const token = generateToken(user._id);

      res.statusCode = 200;
      res.end(JSON.stringify({
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          username: user.username
        }
      }));
    } catch (error) {
      console.error('Login error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Login failed' }));
    }
  }

  // Users handler
  async function handleGetUsers(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const decoded = verifyAuthToken(token);
      
      if (!decoded) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const users = await User.find({ _id: { $ne: decoded.userId } })
        .select('username')
        .lean();

      res.statusCode = 200;
      res.end(JSON.stringify({ users }));
    } catch (error) {
      console.error('Get users error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to get users' }));
    }
  }

  // Invites handler
  async function handleInvites(req, res) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const decoded = verifyAuthToken(token);
    
    if (!decoded) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    switch (req.method) {
      case 'GET':
        await getInvites(req, res, decoded.userId);
        break;
      case 'POST':
        await createInvite(req, res, decoded.userId);
        break;
      case 'PUT':
        await respondToInvite(req, res, decoded.userId);
        break;
      default:
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  }

  async function getInvites(req, res, userId) {
    try {
      const invites = await Invite.find({ 
        $or: [{ fromUserId: userId }, { toUserId: userId }] 
      })
      .populate('fromUserId', 'username')
      .populate('toUserId', 'username')
      .sort({ createdAt: -1 });

      res.statusCode = 200;
      res.end(JSON.stringify({ invites }));
    } catch (error) {
      console.error('Get invites error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to get invites' }));
    }
  }

  async function createInvite(req, res, fromUserId) {
    try {
      const { toUsername } = req.body;

      if (!toUsername) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Username required' }));
        return;
      }

      const toUser = await User.findOne({ username: toUsername });
      if (!toUser) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'User not found' }));
        return;
      }

      if (toUser._id.toString() === fromUserId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Cannot invite yourself' }));
        return;
      }

      // Check if invite already exists
      const existingInvite = await Invite.findOne({
        fromUserId,
        toUserId: toUser._id,
        status: 'pending'
      });

      if (existingInvite) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invite already sent' }));
        return;
      }

      // Check if chat already exists
      const existingChat = await Chat.findOne({
        participants: { $all: [fromUserId, toUser._id] },
        $expr: { $eq: [{ $size: "$participants" }, 2] }
      });

      if (existingChat) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Chat already exists' }));
        return;
      }

      const invite = new Invite({
        fromUserId,
        toUserId: toUser._id
      });

      await invite.save();
      await invite.populate(['fromUserId', 'toUserId'], 'username');

      res.statusCode = 201;
      res.end(JSON.stringify({
        message: 'Invite sent successfully',
        invite
      }));
    } catch (error) {
      console.error('Create invite error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to create invite' }));
    }
  }

  async function respondToInvite(req, res, userId) {
    try {
      const { inviteId, action } = req.body;

      if (!inviteId || !action || !['accept', 'decline'].includes(action)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Valid inviteId and action required' }));
        return;
      }

      const invite = await Invite.findById(inviteId);
      if (!invite) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Invite not found' }));
        return;
      }

      if (invite.toUserId.toString() !== userId) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (invite.status !== 'pending') {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invite already responded to' }));
        return;
      }

      invite.status = action === 'accept' ? 'accepted' : 'declined';
      await invite.save();

      if (action === 'accept') {
        // Create chat
        const chat = new Chat({
          participants: [invite.fromUserId, invite.toUserId]
        });
        await chat.save();

        res.statusCode = 200;
        res.end(JSON.stringify({
          message: 'Invite accepted, chat created',
          chatId: chat._id
        }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ message: 'Invite declined' }));
      }
    } catch (error) {
      console.error('Respond to invite error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to respond to invite' }));
    }
  }

  // Chats handler
  async function handleChats(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const decoded = verifyAuthToken(token);
      
      if (!decoded) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const chats = await Chat.find({ participants: decoded.userId })
        .populate('participants', 'username')
        .lean();

      res.statusCode = 200;
      res.end(JSON.stringify({ chats }));
    } catch (error) {
      console.error('Get chats error:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to get chats' }));
    }
  }

  // Start the HTTPS server for Next.js
  server.listen(port, hostname, () => {
    console.log(`> Ready on https://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
    console.log(`> HTTPS server running with SSL certificates`);
    console.log(`> WebCrypto API available for secure P2P communications`);
  });

  // Start the Socket.IO server on separate port
  socketServer.listen(socketPort, hostname, () => {
    console.log(`> Socket.IO running on https://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${socketPort}`);
    console.log(`> Separated Socket.IO from Next.js to avoid webpack conflicts`);
  });
}).catch((err) => {
  console.error('❌ Failed to prepare Next.js app:', err);
  console.error('This might be a webpack configuration issue');
  process.exit(1);
});
