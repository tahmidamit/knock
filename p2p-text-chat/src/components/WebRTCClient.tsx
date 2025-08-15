import { useEffect, useState, useRef } from 'react';
import SimplePeer from 'simple-peer';

interface WebRTCClientProps {
  socket: any;
  currentUser: string;
  chatId: string;
  otherUserId: string;
  onMessage: (message: any) => void;
}

export default function WebRTCClient({ 
  socket, 
  currentUser, 
  chatId, 
  otherUserId, 
  onMessage 
}: WebRTCClientProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const peerRef = useRef<SimplePeer.Instance | null>(null);

  const initiatePeerConnection = (isInitiator: boolean = true) => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    setIsConnecting(true);
    
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

    peer.on('signal', (signal) => {
      if (signal.type === 'offer') {
        socket.emit('webrtc-offer', {
          targetUserId: otherUserId,
          offer: signal,
          chatId
        });
      } else if (signal.type === 'answer') {
        socket.emit('webrtc-answer', {
          targetUserId: otherUserId,
          answer: signal,
          chatId
        });
      } else {
        // Handle ICE candidates and other signaling data
        socket.emit('webrtc-ice-candidate', {
          targetUserId: otherUserId,
          candidate: signal,
          chatId
        });
      }
    });

    peer.on('connect', () => {
      console.log('WebRTC connection established');
      setIsConnected(true);
      setIsConnecting(false);
    });

    peer.on('data', (data) => {
      try {
        const message = JSON.parse(data.toString());
        onMessage(message);
      } catch (error) {
        console.error('Error parsing WebRTC message:', error);
      }
    });

    peer.on('error', (error) => {
      console.error('WebRTC error:', error);
      setIsConnecting(false);
      setIsConnected(false);
    });

    peer.on('close', () => {
      console.log('WebRTC connection closed');
      setIsConnected(false);
      setIsConnecting(false);
    });

    peerRef.current = peer;
  };

  const sendMessage = (message: string) => {
    if (peerRef.current && isConnected) {
      const messageData = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        sender: currentUser,
        content: message,
        timestamp: new Date().toISOString()
      };
      
      peerRef.current.send(JSON.stringify(messageData));
      return messageData;
    }
    return null;
  };

  useEffect(() => {
    // Listen for WebRTC signaling events
    socket.on('webrtc-offer-received', (data: any) => {
      if (data.chatId === chatId) {
        console.log('Received WebRTC offer');
        initiatePeerConnection(false);
        if (peerRef.current) {
          peerRef.current.signal(data.offer);
        }
      }
    });

    socket.on('webrtc-answer-received', (data: any) => {
      if (data.chatId === chatId && peerRef.current) {
        console.log('Received WebRTC answer');
        peerRef.current.signal(data.answer);
      }
    });

    socket.on('webrtc-ice-candidate-received', (data: any) => {
      if (data.chatId === chatId && peerRef.current) {
        peerRef.current.signal(data.candidate);
      }
    });

    return () => {
      socket.off('webrtc-offer-received');
      socket.off('webrtc-answer-received');
      socket.off('webrtc-ice-candidate-received');
      
      if (peerRef.current) {
        peerRef.current.destroy();
      }
    };
  }, [socket, chatId]);

  return {
    isConnected,
    isConnecting,
    sendMessage,
    connect: () => initiatePeerConnection(true)
  };
}
