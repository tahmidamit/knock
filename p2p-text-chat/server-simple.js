const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

// Simple in-memory storage for development without MongoDB
let users = new Map(); // username -> { id, username, password, isOnline, socketId }
let invites = new Map(); // inviteId -> { from, to, status, timestamp }
let chats = new Map(); // chatId -> { participants, messages }
let userIdCounter = 1;

// Helper functions
const hashPassword = (password) => {
  // Simple hash for demo - use bcrypt in production
  return Buffer.from(password).toString('base64');
};

const verifyPassword = (password, hash) => {
  return hashPassword(password) === hash;
};

const generateToken = (userId) => {
  // Simple token for demo - use JWT in production
  return Buffer.from(`${userId}:${Date.now()}`).toString('base64');
};

const verifyToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [userId] = decoded.split(':');
    return { userId };
  } catch {
    return null;
  }
};

// Prepare Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store for active socket connections
const activeConnections = new Map(); // userId -> socketId

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

          if (users.has(username)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Username already exists' }));
            return;
          }

          const userId = userIdCounter++;
          const user = {
            id: userId,
            username,
            password: hashPassword(password),
            isOnline: false,
            socketId: null
          };

          users.set(username, user);

          const token = generateToken(userId);

          res.statusCode = 201;
          res.end(JSON.stringify({
            message: 'User created successfully',
            token,
            user: { id: userId, username }
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

          const user = users.get(username);
          if (!user) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
            return;
          }

          if (!verifyPassword(password, user.password)) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Invalid credentials' }));
            return;
          }

          const token = generateToken(user.id);
          user.isOnline = true;

          res.statusCode = 200;
          res.end(JSON.stringify({
            message: 'Login successful',
            token,
            user: { id: user.id, username: user.username }
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

  // Authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = verifyToken(token);
      if (!decoded) {
        return next(new Error('Authentication error: Invalid token'));
      }

      // Find user by ID
      const user = Array.from(users.values()).find(u => u.id == decoded.userId);
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.userId = user.id;
      socket.username = user.username;
      next();
    } catch (error) {
      next(new Error('Authentication error: ' + error.message));
    }
  });

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.username, socket.id);

    try {
      // Find and update user
      const user = Array.from(users.values()).find(u => u.id == socket.userId);
      if (user) {
        user.isOnline = true;
        user.socketId = socket.id;
      }

      // Store active connection
      activeConnections.set(socket.userId.toString(), socket.id);

      // Send pending invites
      const pendingInvites = Array.from(invites.values())
        .filter(invite => invite.to === socket.username && invite.status === 'pending');

      socket.emit('pending-invites', pendingInvites);

      // Send active chats
      const userChats = Array.from(chats.entries())
        .filter(([chatId, chat]) => chat.participants.includes(socket.username))
        .map(([chatId, chat]) => ({
          chatId,
          otherUser: chat.participants.find(p => p !== socket.username),
          lastMessage: chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null,
          createdAt: chat.createdAt || new Date().toISOString()
        }));

      socket.emit('active-chats', userChats);

      // Send online users
      const onlineUsers = Array.from(users.values())
        .filter(user => user.isOnline && user.username !== socket.username)
        .map(user => ({ username: user.username, status: 'online' }));

      socket.emit('online-users', onlineUsers);

      // Notify others
      socket.broadcast.emit('user-joined', {
        username: socket.username,
        status: 'online'
      });

    } catch (error) {
      console.error('Connection setup error:', error);
      socket.emit('error', 'Connection setup failed');
    }

    // Handle user search
    socket.on('search-users', (searchTerm) => {
      const results = Array.from(users.values())
        .filter(user => 
          user.isOnline && 
          user.username !== socket.username &&
          user.username.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .map(user => ({ username: user.username, status: 'online' }));

      socket.emit('search-results', results);
    });

    // Handle invite sending
    socket.on('send-invite', (data) => {
      const { toUsername, message = '' } = data;
      
      const toUser = users.get(toUsername);
      if (!toUser) {
        socket.emit('invite-error', 'User not found');
        return;
      }

      if (toUsername === socket.username) {
        socket.emit('invite-error', 'Cannot invite yourself');
        return;
      }

      const inviteId = `${socket.username}-${toUsername}-${Date.now()}`;
      
      // Check if invite already exists
      const existingInvite = Array.from(invites.values())
        .find(inv => inv.from === socket.username && inv.to === toUsername && inv.status === 'pending');

      if (existingInvite) {
        socket.emit('invite-error', 'Invite already sent');
        return;
      }

      // Check if chat already exists
      const existingChat = Array.from(chats.values())
        .find(chat => chat.participants.includes(socket.username) && chat.participants.includes(toUsername));

      if (existingChat) {
        socket.emit('invite-error', 'Chat already exists with this user');
        return;
      }

      const invite = {
        id: inviteId,
        from: socket.username,
        to: toUsername,
        status: 'pending',
        timestamp: new Date().toISOString(),
        message
      };

      invites.set(inviteId, invite);

      // Send to receiver if online
      const receiverSocketId = activeConnections.get(toUser.id.toString());
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new-invite', invite);
      }

      socket.emit('invite-sent', { toUsername });
    });

    // Handle invite response
    socket.on('respond-invite', (data) => {
      const { inviteId, response } = data;
      
      const invite = invites.get(inviteId);
      if (!invite || invite.to !== socket.username) {
        socket.emit('error', 'Invite not found or unauthorized');
        return;
      }

      invite.status = response;

      if (response === 'accept') {
        // Create chat
        const chatId = `${invite.from}-${invite.to}-${Date.now()}`;
        
        const chat = {
          participants: [invite.from, invite.to],
          messages: [],
          createdAt: new Date().toISOString()
        };

        chats.set(chatId, chat);

        // Notify both users
        const senderUser = Array.from(users.values()).find(u => u.username === invite.from);
        if (senderUser) {
          const senderSocketId = activeConnections.get(senderUser.id.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('invite-accepted', {
              username: invite.to,
              chatId
            });
          }
        }

        socket.emit('invite-accepted', {
          username: invite.from,
          chatId
        });
      } else {
        // Notify sender of rejection
        const senderUser = Array.from(users.values()).find(u => u.username === invite.from);
        if (senderUser) {
          const senderSocketId = activeConnections.get(senderUser.id.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('invite-rejected', {
              username: invite.to
            });
          }
        }
      }

      invites.delete(inviteId);
    });

    // Handle sending messages
    socket.on('send-message', (data) => {
      const { chatId, message } = data;
      
      const chat = chats.get(chatId);
      if (!chat) {
        socket.emit('error', 'Chat not found');
        return;
      }

      if (!chat.participants.includes(socket.username)) {
        socket.emit('error', 'Unauthorized');
        return;
      }

      const messageObj = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        sender: socket.username,
        content: message,
        timestamp: new Date().toISOString()
      };

      chat.messages.push(messageObj);

      // Send to other user
      const otherUsername = chat.participants.find(p => p !== socket.username);
      const otherUser = Array.from(users.values()).find(u => u.username === otherUsername);
      
      if (otherUser) {
        const otherSocketId = activeConnections.get(otherUser.id.toString());
        if (otherSocketId) {
          io.to(otherSocketId).emit('new-message', {
            chatId,
            message: messageObj
          });
        }
      }

      socket.emit('message-sent', {
        chatId,
        message: messageObj
      });
    });

    // Handle getting chat history
    socket.on('get-chat-history', (chatId) => {
      const chat = chats.get(chatId);
      if (!chat || !chat.participants.includes(socket.username)) {
        socket.emit('error', 'Chat not found or unauthorized');
        return;
      }

      socket.emit('chat-history', {
        chatId,
        messages: chat.messages
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.username);
      
      // Update user status
      const user = Array.from(users.values()).find(u => u.id == socket.userId);
      if (user) {
        user.isOnline = false;
        user.socketId = null;
      }

      activeConnections.delete(socket.userId.toString());
      
      socket.broadcast.emit('user-left', { username: socket.username });
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`🚀 Server ready on http://${hostname}:${port}`);
      console.log('💾 Using in-memory storage (no MongoDB required)');
      console.log('🔄 Data will be lost when server restarts');
    });
});
