import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const initSocket = (token: string): Socket => {
  if (!socket) {
    // Connect to Socket.IO on separate port (3001) to avoid Next.js conflicts
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const socketPort = 3001; // Separate port for Socket.IO
    
    const socketURL = `${protocol}://${hostname}:${socketPort}`;
        
    socket = io(socketURL, {
      auth: {
        token
      }
    });
  }
  return socket;
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
