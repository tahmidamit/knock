# P2P Text Chat Application

A modern, secure peer-to-peer messaging application built with Next.js, WebRTC, and MongoDB Atlas, featuring real-time communication through Socket.IO WebSockets and direct P2P connections.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your MongoDB Atlas connection string

# Generate SSL certificates (required for WebRTC)
mkcert localhost 127.0.0.1 ::1

# Start the HTTPS server
node server-https.js
```

Access the application at: **https://localhost:3000**

## 🌐 WebSocket & WebRTC Architecture

### Socket.IO WebSockets (Real-time Signaling)
- **Version**: Socket.IO 4.8.1
- **Purpose**: Real-time signaling, user presence, and invite management
- **Server**: Dedicated HTTPS server on port 3001
- **Features**:
  - User authentication and session management
  - Real-time user search and presence detection
  - Invite system with instant notifications
  - WebRTC signaling (offer/answer/ICE candidates)
  - Fallback messaging when P2P connections fail

```javascript
// Socket.IO Events Used
socket.emit('search-users', searchTerm);        // User search
socket.emit('send-invite', { toUsername });     // Send chat invite
socket.emit('webrtc-offer', { offer, chatId }); // WebRTC signaling
socket.emit('ice-candidate', { candidate });    // ICE exchange
```

### WebRTC (Peer-to-Peer Communication)
- **Library**: SimplePeer 9.11.1 (WebRTC wrapper)
- **Purpose**: Direct peer-to-peer messaging and video/voice calls
- **STUN Servers**: Google STUN servers for NAT traversal
- **Features**:
  - Direct P2P text messaging (bypasses server)
  - Video and voice calling capabilities
  - ICE candidate exchange for connection establishment
  - Automatic fallback to Socket.IO if P2P fails

```javascript
// WebRTC Configuration
const peer = new SimplePeer({
  initiator: isInitiator,
  trickle: false,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
});
```

### Communication Flow
```
1. User Search    → Socket.IO WebSocket → Real-time results
2. Send Invite    → Socket.IO WebSocket → Instant notification  
3. Accept Invite  → Socket.IO WebSocket → Chat room creation
4. WebRTC Setup   → Socket.IO signaling → P2P connection established
5. Send Message   → WebRTC P2P Direct  → (Fallback: Socket.IO)
```

## 📖 Features

### 🔌 Real-time Communication
- **WebSocket-powered**: Instant user search, invites, and notifications
- **P2P Messaging**: Direct WebRTC communication between users
- **Dual-channel**: Socket.IO for signaling, WebRTC for content delivery
- **Auto-fallback**: Socket.IO backup when P2P connections fail

### 👥 User Management
- **Live user search** with real-time online/offline status
- **Instant invite system** powered by Socket.IO events
- **Session management** with JWT authentication
- **Presence detection** through WebSocket connections

### 🎥 Media Communication
- **WebRTC video calls** with peer-to-peer media streams
- **Voice calling** with high-quality audio transmission
- **Screen sharing capabilities** (WebRTC media streams)
- **Call management** (accept/reject/end) via Socket.IO signaling

### 🔒 Security & Performance
- **HTTPS-only** communication (required for WebRTC)
- **SSL certificates** for secure WebSocket connections
- **Direct P2P** messaging (no server-side message storage)
- **Efficient signaling** with minimal server overhead

## 🏗️ Technology Stack

### Frontend Technologies
- **Next.js 15.4.6** - React framework with App Router
- **React 19.0.0** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Lucide React** - Modern icon library

### Real-time Communication
- **Socket.IO 4.8.1** - WebSocket library for real-time events
  - Automatic reconnection and fallback transports
  - Room-based communication for chat sessions
  - Event-driven architecture for all real-time features
  
- **SimplePeer 9.11.1** - WebRTC wrapper library
  - Simplified WebRTC peer connection management
  - Built-in ICE candidate handling
  - Media stream support for video/voice calls

### Backend Infrastructure
- **Node.js** - JavaScript runtime
- **Express.js** - Web application framework
- **MongoDB Atlas** - Cloud database with Mongoose ODM
- **JWT** - JSON Web Token authentication
- **HTTPS Server** - Custom SSL-enabled server

### WebRTC Configuration
```javascript
// STUN servers for NAT traversal
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

// SimplePeer configuration
const peerConfig = {
  initiator: false,
  trickle: false,
  config: { iceServers }
};
```

## 🔧 Development Setup

### Prerequisites
- **Node.js 18+** - JavaScript runtime
- **MongoDB Atlas** - Cloud database account
- **mkcert** - Local SSL certificate generation
- **Modern Browser** - Chrome/Firefox/Safari with WebRTC support

## 🎯 WebRTC Features

### P2P Messaging
- **Direct communication** between browsers without server relay
- **End-to-end delivery** with minimal latency
- **Automatic encryption** built into WebRTC protocol
- **Bandwidth efficient** for high-volume messaging

### Media Streaming
- **Video calls** with camera and screen sharing
- **Voice calls** with high-quality audio codecs
- **Media constraints** for bandwidth optimization
- **Stream management** for call controls

### Connection Management
- **ICE candidate exchange** for optimal routing
- **NAT traversal** using STUN servers
- **Connection monitoring** with automatic reconnection
- **Graceful degradation** to Socket.IO fallback

### SSL Requirements
- Use production SSL certificates (Let's Encrypt)
- Ensure HTTPS for all WebRTC functionality
- Configure proper certificate chains

---

**Version**: 1.0.0 | **Last Updated**: August 15, 2025  
**WebSocket**: Socket.IO 4.8.1 | **WebRTC**: SimplePeer 9.11.1
