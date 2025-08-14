import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const initSocket = (token: string): Socket => {
  if (!socket) {
    // Always use the current hostname for socket connection
    const socketURL = typeof window !== 'undefined' 
      ? `http://${window.location.hostname}:3000`
      : 'http://localhost:3000';
        
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
