import { useState, useCallback } from 'react';

interface CallData {
  chatId: string;
  fromUserId: string;
  fromUsername: string;
  callId: string;
}

interface UseCallManagementProps {
  socket: any;
  chatId: string;
  currentUser: string;
  otherUserId: string;
  onStatusUpdate: (status: string) => void;
  onCallAccepted: () => void;
}

export const useCallManagement = ({
  socket,
  chatId,
  currentUser,
  otherUserId,
  onStatusUpdate,
  onCallAccepted
}: UseCallManagementProps) => {
  const [incomingCall, setIncomingCall] = useState<CallData | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const initiateCall = useCallback(() => {
    console.log(`📞 Initiating call to ${otherUserId} for chat ${chatId}`);
    setIsConnecting(true);
    onStatusUpdate(`Calling ${otherUserId}...`);
    
    socket.emit('call-initiate', {
      targetUserId: otherUserId,
      chatId
    });
  }, [socket, otherUserId, chatId, onStatusUpdate]);

  const acceptCall = useCallback(() => {
    if (!incomingCall) return;
    
    console.log(`✅ Accepting call from ${incomingCall.fromUsername}`);
    onStatusUpdate(`Accepting call from ${incomingCall.fromUsername}...`);
    
    socket.emit('call-accept', {
      callId: incomingCall.callId,
      chatId: incomingCall.chatId,
      fromUserId: incomingCall.fromUserId
    });
    
    setIncomingCall(null);
    setIsConnecting(true);
  }, [socket, incomingCall, onStatusUpdate]);

  const rejectCall = useCallback(() => {
    if (!incomingCall) return;
    
    console.log(`❌ Rejecting call from ${incomingCall.fromUsername}`);
    onStatusUpdate(`Rejected call from ${incomingCall.fromUsername}`);
    
    socket.emit('call-reject', {
      callId: incomingCall.callId,
      chatId: incomingCall.chatId,
      fromUserId: incomingCall.fromUserId,
      reason: 'Call declined'
    });
    
    setIncomingCall(null);
    
    // Clear status after 3 seconds
    setTimeout(() => onStatusUpdate(''), 3000);
  }, [socket, incomingCall, onStatusUpdate]);

  const handleIncomingCall = useCallback((data: CallData) => {
    if (data.chatId === chatId) {
      console.log(`📞 Incoming call from ${data.fromUsername}`);
      setIncomingCall(data);
      onStatusUpdate(`Incoming call from ${data.fromUsername}`);
    }
  }, [chatId, onStatusUpdate]);

  const handleCallAccepted = useCallback((data: any) => {
    console.log('🔍 call-accepted event received:', data);
    if (data.chatId === chatId) {
      console.log(`✅ Call accepted by ${data.acceptedBy} - starting WebRTC connection`);
      onStatusUpdate('Call accepted - starting WebRTC...');
      setIsConnecting(false);
      onCallAccepted();
    } else {
      console.log('❌ call-accepted event ignored - chatId mismatch:', {
        eventChatId: data.chatId,
        currentChatId: chatId
      });
    }
  }, [chatId, onStatusUpdate, onCallAccepted]);

  const handleCallRejected = useCallback((data: any) => {
    if (data.chatId === chatId) {
      console.log(`❌ Call rejected: ${data.reason}`);
      onStatusUpdate(`Call rejected: ${data.reason}`);
      setIsConnecting(false);
      
      // Clear status after 5 seconds
      setTimeout(() => onStatusUpdate(''), 5000);
    }
  }, [chatId, onStatusUpdate]);

  const handleCallFailed = useCallback((data: any) => {
    if (data.chatId === chatId) {
      console.log(`❌ Call failed: ${data.reason}`);
      onStatusUpdate(`Call failed: ${data.reason}`);
      setIsConnecting(false);
      
      // Clear status after 5 seconds
      setTimeout(() => onStatusUpdate(''), 5000);
    }
  }, [chatId, onStatusUpdate]);

  return {
    incomingCall,
    isConnecting,
    initiateCall,
    acceptCall,
    rejectCall,
    handleIncomingCall,
    handleCallAccepted,
    handleCallRejected,
    handleCallFailed
  };
};
