require('dotenv').config();
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const connectDB = require('./config/database');
const { authenticate, generateToken } = require('./middleware/auth');

// Import models
const User = require('./models/User');
const Invite = require('./models/Invite');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = 3000;

// Connect to MongoDB
connectDB();

// Prepare Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store for active socket connections
const activeConnections = new Map(); // userId -> socketId

// Store pending WebRTC offers for offline users
const pendingOffers = new Map(); // userId -> [{ offer, chatId, fromUserId, fromUsername, timestamp }]

// Track active call states
const activeCalls = new Map(); // callId -> { chatId, callerUserId, calleeUserId, status, timestamp }

// Call timeout (30 seconds for call initiation, 60 seconds for WebRTC after acceptance)
const CALL_TIMEOUT_MS = 30 * 1000;
const WEBRTC_TIMEOUT_MS = 60 * 1000;

// Offer expiration time (5 minutes)
const OFFER_EXPIRATION_MS = 5 * 60 * 1000;

// Helper function to clean expired offers and calls
function cleanExpiredOffers(io) {
  const now = Date.now();
  
  // Clean expired pending offers
  for (const [userId, offers] of pendingOffers.entries()) {
    const validOffers = offers.filter(offer => (now - offer.timestamp) < OFFER_EXPIRATION_MS);
    if (validOffers.length === 0) {
      pendingOffers.delete(userId);
    } else if (validOffers.length !== offers.length) {
      pendingOffers.set(userId, validOffers);
    }
  }
  
  // Clean expired calls with batch notifications
  const expiredCalls = [];
  for (const [callId, call] of activeCalls.entries()) {
    const timeoutMs = call.status === 'accepted' ? WEBRTC_TIMEOUT_MS : CALL_TIMEOUT_MS;
    if (now - call.timestamp > timeoutMs) {
      expiredCalls.push({ callId, call });
      activeCalls.delete(callId);
    }
  }
  
  // Batch notify all expired calls
  if (expiredCalls.length > 0) {
    console.log(`⏰ Processing ${expiredCalls.length} expired calls`);
    expiredCalls.forEach(({ callId, call }) => {
      const callerSocketId = activeConnections.get(call.callerUserId);
      const calleeSocketId = activeConnections.get(call.calleeUserId);
      
      const timeoutEvent = { chatId: call.chatId, callId };
      if (callerSocketId) io.to(callerSocketId).emit('call-timeout', timeoutEvent);
      if (calleeSocketId) io.to(calleeSocketId).emit('call-timeout', timeoutEvent);
      
      console.log(`⏰ Call timeout for callId: ${callId} (status: ${call.status})`);
    });
  }
}

// Helper function to store pending offer
function storePendingOffer(targetUserId, offer, chatId, fromUserId, fromUsername) {
  if (!pendingOffers.has(targetUserId)) {
    pendingOffers.set(targetUserId, []);
  }
  
  const pendingOffer = {
    offer,
    chatId,
    fromUserId,
    fromUsername,
    timestamp: Date.now()
  };
  
  pendingOffers.get(targetUserId).push(pendingOffer);
  console.log(`📦 Stored pending offer from ${fromUsername} to ${targetUserId} for chat ${chatId}`);
}

// Helper function to find call by criteria
function findCall(criteria) {
  return Array.from(activeCalls.entries()).find(([id, call]) => {
    return Object.keys(criteria).every(key => call[key] === criteria[key]);
  });
}

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

// Helper function to deliver pending offers to a user
function deliverPendingOffers(userId, socket, io) {
  cleanExpiredOffers(io); // Clean expired offers first
  
  const offers = pendingOffers.get(userId);
  if (offers && offers.length > 0) {
    console.log(`📨 Delivering ${offers.length} pending offer(s) to user ${userId}`);
    
    offers.forEach(pendingOffer => {
      socket.emit('webrtc-offer', {
        offer: pendingOffer.offer,
        chatId: pendingOffer.chatId,
        fromUserId: pendingOffer.fromUserId,
        fromUsername: pendingOffer.fromUsername
      });
      console.log(`📬 Delivered pending offer from ${pendingOffer.fromUsername} for chat ${pendingOffer.chatId}`);
    });
    
    // Clear delivered offers
    pendingOffers.delete(userId);
  }
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      
      // Handle API routes
      if (req.url.startsWith('/api/auth/')) {
        await handleAuthAPI(req, res);
      } else {
        await handle(req, res, parsedUrl);
      }
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Auth API handler
  const handleAuthAPI = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        try {
          const { username, password } = JSON.parse(body);

          if (!username || !password) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Username and password are required' }));
            return;
          }

          if (username.length < 2 || username.length > 20) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Username must be between 2 and 20 characters' }));
            return;
          }

          if (password.length < 6) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Password must be at least 6 characters' }));
            return;
          }

          const existingUser = await User.findOne({ username });
          if (existingUser) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Username already exists' }));
            return;
          }

          const user = new User({ username, password });
          await user.save();

          const token = generateToken(user._id);

          res.statusCode = 201;
          res.end(JSON.stringify({
            message: 'User created successfully',
            token,
            user: { id: user._id, username: user.username }
          }));
        } catch (error) {
          console.error('Registration error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Server error' }));
        }
      });
    } else if (pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', async () => {
        try {
          const { username, password } = JSON.parse(body);

          if (!username || !password) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Username and password are required' }));
            return;
          }

          const user = await User.findOne({ username });
          if (!user) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
            return;
          }

          const isPasswordValid = await user.comparePassword(password);
          if (!isPasswordValid) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
            return;
          }

          const token = generateToken(user._id);

          // Update user online status
          user.isOnline = true;
          user.lastSeen = new Date();
          await user.save();

          res.statusCode = 200;
          res.end(JSON.stringify({
            message: 'Login successful',
            token,
            user: { id: user._id, username: user.username }
          }));
        } catch (error) {
          console.error('Login error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Server error' }));
        }
      });
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  };

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Apply authentication middleware
  io.use(authenticate);

  // Clean expired offers every minute
  setInterval(() => cleanExpiredOffers(io), 60000);

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.username, socket.id);

    try {
      // Update user online status and socket ID
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: true,
        socketId: socket.id,
        lastSeen: new Date()
      });

      // Store active connection
      activeConnections.set(socket.userId.toString(), socket.id);

      // Deliver any pending WebRTC offers
      deliverPendingOffers(socket.userId.toString(), socket, io);

      // Send user's pending invites
      const pendingInvites = await Invite.find({
        to: socket.userId,
        status: 'pending'
      }).populate('from', 'username');

      socket.emit('pending-invites', pendingInvites.map(invite => ({
        id: invite._id,
        from: invite.fromUsername,
        to: invite.toUsername,
        status: invite.status,
        timestamp: invite.createdAt,
        message: invite.message
      })));

      // Send user's active chats with online status
      const activeChats = await Chat.find({
        participants: socket.userId,
        isActive: true
      }).populate('participants', 'username isOnline');

      socket.emit('active-chats', activeChats.map(chat => {
        const otherUser = chat.participants.find(p => p._id.toString() !== socket.userId.toString());
        const isOtherUserOnline = activeConnections.has(otherUser._id.toString());
        
        return {
          chatId: chat.chatId,
          otherUser: otherUser.username,
          otherUserId: otherUser._id.toString(),
          isOtherUserOnline: isOtherUserOnline,
          lastMessage: null, // No DB messages for P2P
          createdAt: chat.createdAt
        };
      }));

      // Send list of online users
      const onlineUsers = await User.find({
        isOnline: true,
        _id: { $ne: socket.userId }
      }).select('username');

      socket.emit('online-users', onlineUsers.map(user => ({
        username: user.username,
        status: 'online'
      })));

      // Notify others about new user
      socket.broadcast.emit('user-joined', {
        username: socket.username,
        status: 'online'
      });

    } catch (error) {
      console.error('Connection setup error:', error);
      socket.emit('error', 'Connection setup failed');
    }

    // Handle user search
    socket.on('search-users', async (searchTerm) => {
      try {
        const users = await User.find({
          username: { $regex: searchTerm, $options: 'i' },
          _id: { $ne: socket.userId },
          isOnline: true
        }).select('username').limit(10);

        socket.emit('search-results', users.map(user => ({
          username: user.username,
          status: 'online'
        })));
      } catch (error) {
        console.error('Search error:', error);
        socket.emit('error', 'Search failed');
      }
    });

    // Handle invite sending
    socket.on('send-invite', async (data) => {
      try {
        const { toUsername, message = '' } = data;
        
        const toUser = await User.findOne({ username: toUsername });
        if (!toUser) {
          socket.emit('invite-error', 'User not found');
          return;
        }

        if (toUser._id.toString() === socket.userId.toString()) {
          socket.emit('invite-error', 'Cannot invite yourself');
          return;
        }

        // Check if invite already exists
        const existingInvite = await Invite.findOne({
          from: socket.userId,
          to: toUser._id,
          status: 'pending'
        });

        if (existingInvite) {
          socket.emit('invite-error', 'Invite already sent');
          return;
        }

        // Check if chat already exists
        const existingChat = await Chat.findOne({
          participants: { $all: [socket.userId, toUser._id] },
          isActive: true
        });

        if (existingChat) {
          socket.emit('invite-error', 'Chat already exists with this user');
          return;
        }

        const invite = new Invite({
          from: socket.userId,
          fromUsername: socket.username,
          to: toUser._id,
          toUsername: toUsername,
          message
        });

        await invite.save();

        // Send invite to receiver if online
        const receiverSocketId = activeConnections.get(toUser._id.toString());
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new-invite', {
            id: invite._id,
            from: invite.fromUsername,
            to: invite.toUsername,
            status: invite.status,
            timestamp: invite.createdAt,
            message: invite.message
          });
        }

        socket.emit('invite-sent', { toUsername });
      } catch (error) {
        console.error('Send invite error:', error);
        socket.emit('invite-error', 'Failed to send invite');
      }
    });

    // Handle invite response
    socket.on('respond-invite', async (data) => {
      try {
        const { inviteId, response } = data;
        
        const invite = await Invite.findById(inviteId);
        if (!invite) {
          socket.emit('error', 'Invite not found');
          return;
        }

        if (invite.to.toString() !== socket.userId.toString()) {
          socket.emit('error', 'Unauthorized');
          return;
        }

        invite.status = response;
        await invite.save();

        if (response === 'accept') {
          // Create chat room
          const chatId = `${invite.fromUsername}-${invite.toUsername}-${Date.now()}`;
          
          const chat = new Chat({
            participants: [invite.from, invite.to],
            participantUsernames: [invite.fromUsername, invite.toUsername],
            chatId
          });

          await chat.save();

          // Notify both users
          const senderSocketId = activeConnections.get(invite.from.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('invite-accepted', {
              username: invite.toUsername,
              chatId
            });
          }

          socket.emit('invite-accepted', {
            username: invite.fromUsername,
            chatId
          });
        } else {
          // Notify sender of rejection
          const senderSocketId = activeConnections.get(invite.from.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('invite-rejected', {
              username: invite.toUsername
            });
          }
        }
      } catch (error) {
        console.error('Respond invite error:', error);
        socket.emit('error', 'Failed to respond to invite');
      }
    });

    // Handle sending messages - P2P signaling only, no DB storage
    socket.on('send-message', async (data) => {
      try {
        const { chatId, message } = data;
        
        const chat = await Chat.findOne({ chatId });
        if (!chat) {
          socket.emit('error', 'Chat not found');
          return;
        }

        // Verify user is part of this chat
        if (!chat.participants.includes(socket.userId)) {
          socket.emit('error', 'Unauthorized');
          return;
        }

        // Find the other user and forward the message for P2P signaling
        const otherUserId = chat.participants.find(p => p.toString() !== socket.userId.toString());
        const otherSocketId = activeConnections.get(otherUserId.toString());

        const messageData = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          sender: socket.username,
          content: message,
          timestamp: new Date().toISOString()
        };

        // Send to the other user for P2P connection (signaling only)
        if (otherSocketId) {
          io.to(otherSocketId).emit('p2p-message', {
            chatId,
            message: messageData
          });
        }

        // Confirm to sender
        socket.emit('p2p-message-sent', {
          chatId,
          message: messageData
        });
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', 'Failed to send message');
      }
    });

    // Handle getting chat history
    socket.on('get-chat-history', async (chatId) => {
      try {
        console.log(`Getting chat history for chatId: ${chatId}, userId: ${socket.userId}`);
        
        const chat = await Chat.findOne({ chatId });
        if (!chat) {
          console.log(`Chat not found for chatId: ${chatId}`);
          socket.emit('error', 'Chat not found');
          return;
        }

        console.log(`Chat found, participants: ${chat.participants}`);
        console.log(`Socket userId: ${socket.userId}`);
        
        if (!chat.participants.includes(socket.userId)) {
          console.log(`User ${socket.userId} not authorized for chat ${chatId}`);
          socket.emit('error', 'Unauthorized access to chat');
          return;
        }

        // No messages from DB - P2P only, just confirm chat exists
        console.log(`Chat ${chatId} confirmed for P2P messaging`);

        socket.emit('chat-history', {
          chatId,
          messages: [] // No DB messages, WebRTC handles all messaging
        });
      } catch (error) {
        console.error('Get chat history error:', error);
        socket.emit('error', 'Failed to get chat history');
      }
    });

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
        message: `Call initiated to ${targetUserId}`
      });
      
      console.log(`📞 Call notification sent from ${socket.username} to ${targetUserId} (${callId})`);
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
        
        // Clean up the call
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

    // WebRTC signaling for P2P connections (only after call acceptance)
    socket.on('webrtc-offer', (data) => {
      const { targetUserId, offer, chatId } = data;
      const fromUserId = socket.userId.toString();
      
      console.log(`📞 WebRTC offer received from ${socket.username} for chat ${chatId} to user ${targetUserId}`);
      
      // Check if there's an accepted call for this chat
      console.log(`🔍 Searching for accepted call - chatId: ${chatId}, fromUserId: ${fromUserId}, targetUserId: ${targetUserId}`);
      console.log(`🔍 Active calls:`, Array.from(activeCalls.entries()).map(([id, call]) => ({
        id,
        chatId: call.chatId,
        status: call.status,
        callerUserId: call.callerUserId,
        calleeUserId: call.calleeUserId
      })));
      
      const acceptedCall = Array.from(activeCalls.values()).find(call => 
        call.chatId === chatId && 
        call.status === 'accepted' && 
        call.callerUserId === fromUserId &&
        call.calleeUserId === targetUserId
      );
      
      console.log(`🔍 Found accepted call:`, acceptedCall);
      
      if (!acceptedCall) {
        console.log(`🔒 WebRTC offer rejected - no accepted call for chat ${chatId}`);
        console.log(`🔍 Search criteria: chatId=${chatId}, status=accepted, callerUserId=${fromUserId}, calleeUserId=${targetUserId}`);
        socket.emit('webrtc-offer-rejected', {
          chatId,
          reason: 'No accepted call found. Please initiate call first.'
        });
        return;
      }
      
      // Send offer using utility function
      if (notifyCallEvent(io, targetUserId, 'webrtc-offer', {
        offer,
        chatId,
        fromUserId: fromUserId,
        fromUsername: socket.username
      })) {
        console.log(`📞 WebRTC offer sent from ${socket.username} to ${targetUserId}`);
      } else {
        // Target user is offline
        socket.emit('webrtc-offer-rejected', {
          chatId,
          reason: 'Target user is no longer online'
        });
        
        // Clean up the call since user went offline
        const callToDelete = Array.from(activeCalls.entries()).find(([id, call]) => 
          call.chatId === chatId && call.status === 'accepted'
        );
        if (callToDelete) {
          activeCalls.delete(callToDelete[0]);
        }
        
        console.log(`❌ WebRTC offer failed - user ${targetUserId} went offline`);
      }
    });

    socket.on('webrtc-answer', (data) => {
      const { targetUserId, answer, chatId } = data;
      
      console.log(`📞 WebRTC answer received from ${socket.username} for chat ${chatId}`);
      
      if (notifyCallEvent(io, targetUserId, 'webrtc-answer', {
        answer,
        chatId,
        fromUserId: socket.userId.toString(),
        fromUsername: socket.username
      })) {
        console.log(`📞 WebRTC answer forwarded from ${socket.username} to ${targetUserId}`);
        
        // Mark the call as connected and clean up call tracking
        const callToComplete = Array.from(activeCalls.entries()).find(([id, call]) => 
          call.chatId === chatId && call.status === 'accepted'
        );
        if (callToComplete) {
          activeCalls.delete(callToComplete[0]);
          console.log(`✅ Call completed for chat ${chatId} - WebRTC established`);
        }
      } else {
        console.log(`⚠️ Target user ${targetUserId} not found for answer from ${socket.username}`);
      }
    });

    socket.on('webrtc-ice-candidate', (data) => {
      const { targetUserId, candidate, chatId } = data;
      
      console.log(`🧊 ICE candidate from ${socket.username} for chat ${chatId}`);
      
      if (notifyCallEvent(io, targetUserId, 'webrtc-ice-candidate', {
        candidate,
        chatId,
        fromUserId: socket.userId.toString()
      })) {
        console.log(`🧊 ICE candidate forwarded from ${socket.username} to ${targetUserId}`);
      } else {
        console.log(`⚠️ Target user ${targetUserId} not found for ICE candidate from ${socket.username}`);
      }
    });

    // Handle WebRTC connection success
    socket.on('webrtc-connected', (data) => {
      const { chatId } = data;
      console.log(`✅ WebRTC connection established for chat ${chatId} by ${socket.username}`);
      
      // Remove call from timeout tracking since WebRTC is now established
      const callToComplete = Array.from(activeCalls.entries()).find(([id, call]) => 
        call.chatId === chatId && call.status === 'accepted'
      );
      if (callToComplete) {
        activeCalls.delete(callToComplete[0]);
        console.log(`🗑️ Removed call ${callToComplete[0]} from timeout tracking - WebRTC established`);
      }
    });

    // Handle WebRTC connection failure
    socket.on('webrtc-connection-failed', (data) => {
      const { chatId } = data;
      console.log(`❌ WebRTC connection failed for chat ${chatId}`);
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      try {
        console.log('User disconnected:', socket.username);
        
        // Update user offline status
        await User.findByIdAndUpdate(socket.userId, {
          isOnline: false,
          socketId: null,
          lastSeen: new Date()
        });

        // Remove from active connections
        activeConnections.delete(socket.userId.toString());
        
        // Clean up any active calls involving this user
        const userId = socket.userId.toString();
        for (const [callId, call] of activeCalls.entries()) {
          if (call.callerUserId === userId || call.calleeUserId === userId) {
            // Notify the other party that user disconnected
            const otherUserId = call.callerUserId === userId ? call.calleeUserId : call.callerUserId;
            const otherSocketId = activeConnections.get(otherUserId);
            
            if (otherSocketId) {
              io.to(otherSocketId).emit('call-ended', {
                chatId: call.chatId,
                reason: 'Other user disconnected',
                callId
              });
            }
            
            activeCalls.delete(callId);
            console.log(`🔚 Cleaned up call ${callId} due to user ${socket.username} disconnecting`);
          }
        }
        
        // Notify others
        socket.broadcast.emit('user-left', { username: socket.username });
      } catch (error) {
      }
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Local network access: http://192.168.0.103:${port}`);
      console.log(`> Use your phone to access: http://192.168.0.103:${port}`);
    });
});
