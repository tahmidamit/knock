# P2P Text Chat with MongoDB Integration

## Prerequisites

Before running the application, make sure you have:

1. **Node.js** (v18 or higher)
2. **MongoDB** installed and running locally, OR
3. **MongoDB Atlas** account for cloud database

## MongoDB Setup Options

### Option 1: Local MongoDB
1. Install MongoDB Community Server from https://www.mongodb.com/try/download/community
2. Start MongoDB service:
   ```bash
   # Windows (if installed as service)
   net start MongoDB
   
   # Manual start
   mongod --dbpath /path/to/data/directory
   ```

### Option 2: MongoDB Atlas (Cloud)
1. Create a free account at https://www.mongodb.com/atlas
2. Create a new cluster
3. Get your connection string
4. Create a `.env` file in the project root:
   ```
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/p2p-text-chat
   JWT_SECRET=your-secret-key-here
   ```

### Option 3: Docker MongoDB
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

## Installation and Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set environment variables** (create `.env` file):
   ```
   MONGODB_URI=mongodb://localhost:27017/p2p-text-chat
   JWT_SECRET=your-secret-key-change-in-production
   ```

3. **Start the application**:
   ```bash
   npm run dev
   ```

4. **Open your browser**:
   Navigate to `http://localhost:3000`

## Features

### Authentication System
- User registration with username and password
- Secure password hashing with bcrypt
- JWT token-based authentication
- Persistent login sessions

### Database Models
- **Users**: Store user credentials and online status
- **Invites**: Manage chat invitations between users
- **Chats**: Store chat room information
- **Messages**: Persist all chat messages

### Real-time Features
- WebSocket connections with Socket.io
- Live user presence detection
- Instant message delivery
- Real-time invite notifications

## Testing the Application

### Single Device Testing
1. Open two browser windows/tabs
2. Register different users in each window
3. Send invites between users
4. Accept invites and start chatting

### Multi-Device Testing
1. Ensure MongoDB is accessible from all devices
2. Use your local IP address: `http://YOUR_IP:3000`
3. Register users from different devices
4. Test cross-device messaging

## Database Collections

The application creates the following MongoDB collections:

- `users` - User accounts and authentication data
- `invites` - Chat invitations between users
- `chats` - Chat room configurations
- `messages` - All chat messages with timestamps

## Troubleshooting

### MongoDB Connection Issues
```bash
# Check if MongoDB is running
mongosh

# If connection fails, start MongoDB
mongod --dbpath /path/to/data

# Or use MongoDB service
net start MongoDB
```

### Common Errors
1. **"Cannot connect to MongoDB"** - Ensure MongoDB is running
2. **"Authentication failed"** - Check JWT_SECRET in environment
3. **"Username already exists"** - Try a different username
4. **"Invite not received"** - Check user is online and refresh page

## API Endpoints

- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Authenticate user login

## Socket Events

### Client to Server
- `search-users` - Search for online users
- `send-invite` - Send chat invitation
- `respond-invite` - Accept/reject invitation
- `send-message` - Send chat message
- `get-chat-history` - Retrieve message history

### Server to Client
- `online-users` - List of online users
- `new-invite` - Incoming chat invitation
- `invite-accepted` - Invitation was accepted
- `new-message` - Incoming chat message
- `chat-history` - Message history response
