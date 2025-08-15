import { useRef, useCallback } from 'react';
import SimplePeer from 'simple-peer';

interface UseWebRTCProps {
  socket: any;
  chatId: string;
  currentUser: string;
  otherUserId: string;
  onConnectionChange: (connected: boolean) => void;
  onStatusUpdate: (status: string) => void;
}

export const useWebRTC = ({
  socket,
  chatId,
  currentUser,
  otherUserId,
  onConnectionChange,
  onStatusUpdate
}: UseWebRTCProps) => {
  const peerRef = useRef<SimplePeer.Instance | null>(null);

  const cleanupPeer = useCallback(() => {
    if (peerRef.current) {
      console.log('🧹 Cleaning up existing peer connection');
      try {
        peerRef.current.removeAllListeners();
        peerRef.current.destroy();
      } catch (error) {
        console.warn('Error during peer cleanup:', error);
      }
      peerRef.current = null;
    }
    onConnectionChange(false);
  }, [onConnectionChange]);

  const initiatePeerConnection = useCallback((isInitiator: boolean) => {
    console.log(`🔄 Initiating peer connection - Initiator: ${isInitiator}`);
    
    // Clean up any existing connection first
    cleanupPeer();
    
    onStatusUpdate('Creating peer connection...');

    try {
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

      peer.on('signal', (data: any) => {
        console.log(`📡 Peer signal event - Type: ${data.type}`);
        
        if (data.type === 'offer') {
          console.log('📤 Sending WebRTC offer to server');
          onStatusUpdate('Sending call offer...');
          socket.emit('webrtc-offer', {
            targetUserId: otherUserId,
            offer: data,
            chatId
          });
        } else if (data.type === 'answer') {
          console.log('📤 Sending WebRTC answer to server');
          onStatusUpdate('Sending call answer...');
          socket.emit('webrtc-answer', {
            targetUserId: otherUserId,
            answer: data,
            chatId
          });
        }
      });

      peer.on('connect', () => {
        console.log('✅ P2P connection established!');
        onConnectionChange(true);
        onStatusUpdate('Connected via P2P');
        
        // Notify server that WebRTC is connected
        socket.emit('webrtc-connected', { chatId });
      });

      peer.on('data', (data: any) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('📨 Received P2P message:', message);
          
          // Handle the received message through callback
          // This will be passed from the component
        } catch (error) {
          console.error('Error parsing P2P message:', error);
        }
      });

      peer.on('error', (err: any) => {
        console.error('❌ Peer connection error:', err);
        onStatusUpdate(`Connection error: ${err.message}`);
        cleanupPeer();
        
        // Auto-retry after a delay
        setTimeout(() => {
          onStatusUpdate('Retrying connection...');
        }, 2000);
      });

      peer.on('close', () => {
        console.log('🔌 Peer connection closed');
        onStatusUpdate('Connection closed');
        cleanupPeer();
      });

      peerRef.current = peer;
      
    } catch (error) {
      console.error('❌ Failed to create peer connection:', error);
      onStatusUpdate('Failed to create connection');
      cleanupPeer();
    }
  }, [socket, chatId, otherUserId, cleanupPeer, onConnectionChange, onStatusUpdate]);

  const sendMessage = useCallback((message: any) => {
    if (peerRef.current && peerRef.current.connected) {
      try {
        peerRef.current.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Error sending P2P message:', error);
        return false;
      }
    }
    return false;
  }, []);

  const handleOffer = useCallback((data: any) => {
    if (data.chatId === chatId && data.fromUserId !== currentUser) {
      console.log('📥 Received WebRTC offer');
      onStatusUpdate('Received call offer...');
      initiatePeerConnection(false);
      
      // Wait for peer to be ready, then signal the offer
      setTimeout(() => {
        if (peerRef.current) {
          peerRef.current.signal(data.offer);
        }
      }, 100);
    }
  }, [chatId, currentUser, initiatePeerConnection, onStatusUpdate]);

  const handleAnswer = useCallback((data: any) => {
    if (data.chatId === chatId && peerRef.current) {
      console.log('📥 Received WebRTC answer');
      onStatusUpdate('Received call answer...');
      peerRef.current.signal(data.answer);
    }
  }, [chatId, onStatusUpdate]);

  const handleIceCandidate = useCallback((data: any) => {
    if (data.chatId === chatId && peerRef.current) {
      console.log('🧊 Received ICE candidate');
      peerRef.current.signal(data.candidate);
    }
  }, [chatId]);

  return {
    initiatePeerConnection,
    sendMessage,
    cleanupPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    isConnected: () => peerRef.current?.connected || false
  };
};
