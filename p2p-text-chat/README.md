# P2P Text Chat Application

A real-time peer-to-peer text messaging application built with Next.js, Socket.io, and TypeScript.

## Features

- **User Registration**: Simple username-based registration
- **Real-time Communication**: Instant messaging using Socket.io
- **Invite System**: Send and receive chat invites
- **User Search**: Search for online users by username
- **Chat Management**: Multiple chat sessions with different users
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

## How It Works

### Connection Flow
1. **Registration**: Users choose a unique username to join the platform
2. **Invite System**: Users can search for other online users and send chat invites
3. **Chat Activation**: Once an invite is accepted, both users can start messaging
4. **Real-time Messaging**: Messages are delivered instantly using WebSocket connections

### Architecture
- **Frontend**: Next.js with React hooks and TypeScript
- **Backend**: Custom Socket.io server integrated with Next.js
- **State Management**: React Context for managing chat state
- **UI Components**: Modular React components with Tailwind CSS
- **Real-time Communication**: Socket.io for bidirectional communication

## Tech Stack

- **Frontend Framework**: Next.js 15.4.6 with TypeScript
- **Styling**: Tailwind CSS 4.0
- **Real-time Communication**: Socket.io 4.8.1
- **Icons**: Lucide React
- **State Management**: React Context + useReducer
- **Development**: TypeScript, ESLint

## Getting Started

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```

3. **Open your browser**:
   Navigate to `http://localhost:3000`

### Usage

1. **Join the Chat**:
   - Enter a unique username (2-20 characters, no spaces)
   - Click "Join Chat"

2. **Send Invites**:
   - Use the search bar to find other users
   - Click "Invite" next to any online user
   - Wait for them to accept your invite

3. **Accept Invites**:
   - Incoming invites appear in the "Pending Invites" section
   - Click "Accept" or "Reject" to respond

4. **Start Chatting**:
   - Once an invite is accepted, you'll be taken to the chat section
   - Select a chat from the list to start messaging
   - Type your message and press Enter or click Send

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the application for production
- `npm run start` - Start the production server
- `npm run lint` - Run ESLint for code quality checks

## Testing the Application

### Single Device Testing
1. Open two browser windows/tabs to `http://localhost:3000`
2. Register with different usernames in each window
3. Send invites between the users
4. Test the messaging functionality

### Multi-Device Testing
1. Start the development server
2. Find your local IP address
3. Access the app from different devices on the same network
4. Register different users and test the invite/chat flow
