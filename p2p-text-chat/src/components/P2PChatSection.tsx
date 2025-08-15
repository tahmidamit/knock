'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, Phone, PhoneOff, Wifi, WifiOff } from 'lucide-react';
import { useChat } from '../contexts/ChatContext';
import SimplePeer from 'simple-peer';

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

interface P2PChatSectionProps {
  socket: any;
  currentUser: string;
  chatId: string;
  otherUser: string;
  otherUserId: string;
  onBack: () => void;
}

export default function P2PChatSection({ 
  socket, 
  currentUser, 
  chatId, 
  otherUser, 
  otherUserId,
  onBack 
}: P2PChatSectionProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isWebRTCConnected, setIsWebRTCConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0); // Force re-initialization
  const [offerStatus, setOfferStatus] = useState<string>('');
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);

  // Local Storage key for this chat
  const storageKey = `chat_${chatId}_messages`;

  // Load messages from localStorage on component mount
  useEffect(() => {
    const savedMessages = localStorage.getItem(storageKey);
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (error) {
        console.error('Error loading messages from localStorage:', error);
      }
    }
  }, [storageKey]);

  // Save messages to localStorage whenever messages change
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [messages, storageKey]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize WebRTC
  const initiatePeerConnection = (isInitiator: boolean = true) => {
    // Prevent duplicate connections
    if (peerRef.current || isConnecting) {
      console.log('⚠️ Peer connection already exists or is connecting, skipping');
      return;
    }

    console.log(`🔄 Initiating WebRTC connection (${isInitiator ? 'initiator' : 'receiver'})`);
    setIsConnecting(true);
    
    const peer = new SimplePeer({
      initiator: isInitiator,
      trickle: false
    });

    peer.on('signal', (signal: any) => {
      if (signal.type === 'offer') {
        console.log('📤 Sending WebRTC offer');
        socket.emit('webrtc-offer', {
          targetUserId: otherUserId,
          offer: signal,
          chatId
        });
      } else if (signal.type === 'answer') {
        console.log('📤 Sending WebRTC answer');
        socket.emit('webrtc-answer', {
          targetUserId: otherUserId,
          answer: signal,
          chatId
        });
      }
    });

    peer.on('connect', () => {
      console.log('🔗 WebRTC P2P connection established');
      setIsWebRTCConnected(true);
      setIsConnecting(false);
      setOfferStatus(''); // Clear any pending status
    });

    peer.on('data', (data: any) => {
      try {
        const message = JSON.parse(data.toString());
        setMessages(prev => [...prev, message]);
      } catch (error) {
        console.error('Error parsing WebRTC message:', error);
      }
    });

    peer.on('error', (error: any) => {
      console.error('WebRTC error:', error);
      setIsConnecting(false);
      setIsWebRTCConnected(false);
      
      // Clean up the failed peer
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
      
      // Increment connection attempt to reset listeners for retry
      setConnectionAttempt(prev => prev + 1);
    });

    peer.on('close', () => {
      console.log('WebRTC connection closed');
      setIsWebRTCConnected(false);
      setIsConnecting(false);
      
      // Clean up the closed peer
      if (peerRef.current === peer) {
        peerRef.current = null;
      }
    });

    peerRef.current = peer;
  };

  // WebRTC signaling event listeners  
  useEffect(() => {
    console.log(`🔧 Setting up WebRTC listeners (attempt ${connectionAttempt}) for chat ${chatId}`);

    const handleOffer = (data: any) => {
      if (data.chatId === chatId) {
        console.log('📞 Received WebRTC offer from:', data.fromUsername);
        
        // Always accept incoming offers (the initiator logic on sender side should prevent race conditions)
        if (!peerRef.current && !isConnecting && !isWebRTCConnected) {
          console.log('🤝 Accepting offer and creating peer connection');
          setOfferStatus('Accepting incoming connection...');
          initiatePeerConnection(false);
          // Use setTimeout to ensure peer is created before signaling
          setTimeout(() => {
            if (peerRef.current) {
              peerRef.current.signal(data.offer);
            }
          }, 100);
        } else {
          console.log('⚠️ Ignoring offer - already have connection:', { 
            hasPeer: !!peerRef.current, 
            isConnecting, 
            isWebRTCConnected 
          });
        }
      }
    };

    const handleAnswer = (data: any) => {
      if (data.chatId === chatId && peerRef.current) {
        console.log('✅ Received WebRTC answer from:', data.fromUser);
        peerRef.current.signal(data.answer);
      }
    };

    const handleIceCandidate = (data: any) => {
      if (data.chatId === chatId && peerRef.current) {
        console.log('🧊 Received ICE candidate');
        peerRef.current.signal(data.candidate);
      }
    };

    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);

    // Call flow events
    socket.on('incoming-call', (data: any) => {
      if (data.chatId === chatId) {
        console.log(`📞 Incoming call from ${data.fromUsername}`);
        setIncomingCall(data);
        setOfferStatus(`Incoming call from ${data.fromUsername}`);
      }
    });

    socket.on('call-accepted', (data: any) => {
      console.log('🔍 call-accepted event received:', data);
      if (data.chatId === chatId) {
        console.log(`✅ Call accepted by ${data.acceptedBy} - starting WebRTC connection`);
        setOfferStatus('Call accepted - starting WebRTC...');
        setIsConnecting(false);
        
        // Caller initiates WebRTC connection
        console.log(`🎯 Caller (${currentUser}) initiating WebRTC connection`);
        initiatePeerConnection(true);
      } else {
        console.log('❌ call-accepted event ignored - chatId mismatch:', {
          eventChatId: data.chatId,
          currentChatId: chatId
        });
      }
    });

    socket.on('call-rejected', (data: any) => {
      if (data.chatId === chatId) {
        console.log(`❌ Call rejected: ${data.reason}`);
        setOfferStatus(`Call rejected: ${data.reason}`);
        setIsConnecting(false);
        // Clear status after 5 seconds
        setTimeout(() => setOfferStatus(''), 5000);
      }
    });

    socket.on('call-failed', (data: any) => {
      if (data.chatId === chatId) {
        console.log(`❌ Call failed: ${data.reason}`);
        setOfferStatus(`Call failed: ${data.reason}`);
        setIsConnecting(false);
        // Clear status after 5 seconds
        setTimeout(() => setOfferStatus(''), 5000);
      }
    });

    // Handle pending offer notification
    socket.on('webrtc-offer-pending', (data: any) => {
      if (data.chatId === chatId) {
        console.log('⏳ WebRTC offer stored as pending:', data);
        setOfferStatus('Offer sent - will be delivered when user comes online');
        // Clear status after 5 seconds
        setTimeout(() => setOfferStatus(''), 5000);
      }
    });

    // Socket message events
    socket.on('receive-message', (data: any) => {
      if (data.chatId === chatId) {
        const message: Message = {
          id: data.messageId || `${Date.now()}-${Math.random()}`,
          sender: data.sender,
          content: data.content,
          timestamp: data.timestamp || new Date().toISOString()
        };
        
        setMessages(prev => {
          // Check if message already exists (prevent duplicates)
          const exists = prev.some(m => m.id === message.id);
          if (exists) return prev;
          return [...prev, message];
        });
        
        console.log('📨 Message received via socket:', message);
      }
    });

    return () => {
      console.log('🧹 Cleaning up WebRTC listeners');
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
      socket.off('incoming-call');
      socket.off('call-accepted');
      socket.off('call-rejected');
      socket.off('call-failed');
      socket.off('receive-message');
      socket.off('webrtc-offer-pending');
    };
  }, [socket, chatId, connectionAttempt]); // Include connectionAttempt to force re-setup

  // Component cleanup
  useEffect(() => {
    return () => {
      console.log('🧹 Component unmounting - cleaning up peer connection');
      if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
      }
    };
  }, []);

  // Call management functions
  const initiateCall = () => {
    console.log(`📞 Initiating call to ${otherUserId} for chat ${chatId}`);
    setIsConnecting(true);
    setOfferStatus(`Calling ${otherUser}...`);
    
    socket.emit('call-initiate', {
      targetUserId: otherUserId,
      chatId
    });
  };

  const acceptCall = () => {
    if (!incomingCall) return;
    
    console.log(`✅ Accepting call from ${incomingCall.fromUsername}`);
    setOfferStatus(`Accepting call from ${incomingCall.fromUsername}...`);
    
    socket.emit('call-accept', {
      callId: incomingCall.callId,
      chatId: incomingCall.chatId,
      fromUserId: incomingCall.fromUserId
    });
    
    setIncomingCall(null);
    setIsConnecting(true);
  };

  const rejectCall = () => {
    if (!incomingCall) return;
    
    console.log(`❌ Rejecting call from ${incomingCall.fromUsername}`);
    setOfferStatus(`Rejected call from ${incomingCall.fromUsername}`);
    
    socket.emit('call-reject', {
      callId: incomingCall.callId,
      chatId: incomingCall.chatId,
      fromUserId: incomingCall.fromUserId,
      reason: 'Call declined'
    });
    
    setIncomingCall(null);
    
    // Clear status after 3 seconds
    setTimeout(() => setOfferStatus(''), 3000);
  };

  const retryConnection = () => {
    console.log('🔄 Retrying WebRTC connection...');
    setConnectionAttempt(prev => prev + 1);
    setOfferStatus('Retrying connection...');
    
    // Clean up existing connection
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsWebRTCConnected(false);
    setIsConnecting(false);
    
    // Retry after a short delay
    setTimeout(() => {
      initiatePeerConnection(true);
    }, 1000);
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;

    const messageData: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sender: currentUser,
      content: messageInput.trim(),
      timestamp: new Date().toISOString()
    };

    // Add to local messages immediately for optimistic update
    setMessages(prev => [...prev, messageData]);
    setMessageInput('');

    // Try P2P first, fallback to socket
    if (isWebRTCConnected && peerRef.current) {
      try {
        peerRef.current.send(JSON.stringify(messageData));
        console.log('📨 Message sent via P2P');
      } catch (error) {
        console.log('📡 P2P failed, falling back to socket');
        socket.emit('send-message', {
          chatId,
          content: messageData.content,
          sender: currentUser,
          messageId: messageData.id
        });
      }
    } else {
      console.log('📡 Sending message via socket');
      socket.emit('send-message', {
        chatId,
        content: messageData.content,
        sender: currentUser,
        messageId: messageData.id
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="text-white hover:text-blue-200 transition-colors"
          >
            ← Back
          </button>
          <div>
            <h2 className="font-semibold">Chat with {otherUser}</h2>
            <p className="text-sm text-blue-200">
              {isWebRTCConnected ? '🔗 P2P Connected' : '📡 WebRTC Disconnected'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {incomingCall ? (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-blue-200">Incoming call...</span>
              <button
                onClick={acceptCall}
                className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600"
              >
                <Phone className="w-4 h-4" />
              </button>
              <button
                onClick={rejectCall}
                className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={initiateCall}
              disabled={isConnecting || isWebRTCConnected}
              className={`p-2 rounded-full ${
                isConnecting || isWebRTCConnected
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              <Phone className="w-4 h-4" />
            </button>
          )}
          
          {!isWebRTCConnected && offerStatus && (
            <button
              onClick={retryConnection}
              className="px-3 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-gray-100 p-2 text-center text-sm">
        {isWebRTCConnected ? (
          <span className="text-green-600 flex items-center justify-center space-x-1">
            <Wifi size={16} />
            <span>🔒 Connected via P2P - messages are sent directly</span>
          </span>
        ) : (
          <span className="text-orange-600 flex items-center justify-center space-x-1">
            <WifiOff size={16} />
            <span>📡 Messages sent via server - initiate call for P2P connection</span>
          </span>
        )}
      </div>

      {/* Offer Status */}
      {offerStatus && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3 mx-4 mt-2 rounded">
          <div className="flex items-center space-x-2">
            <div className="text-blue-600">
              <Wifi size={16} />
            </div>
            <p className="text-blue-800 text-sm">{offerStatus}</p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <p>No messages yet.</p>
            <p className="text-sm">Connect WebRTC to start chatting directly!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === currentUser ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                  message.sender === currentUser
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-black'
                }`}
              >
                <p className="text-sm font-medium mb-1">{message.sender}</p>
                <p>{message.content}</p>
                <p className="text-xs opacity-70 mt-1">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="border-t p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageInput.trim()}
            className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {isWebRTCConnected 
            ? '� Messages are sent directly peer-to-peer' 
            : '📡 Messages are sent through server'
          }
        </p>
      </div>
    </div>
  );
}
