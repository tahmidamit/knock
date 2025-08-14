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

    // Handle pending offer notification
    socket.on('webrtc-offer-pending', (data: any) => {
      if (data.chatId === chatId) {
        console.log('⏳ WebRTC offer stored as pending:', data);
        setOfferStatus('Offer sent - will be delivered when user comes online');
        // Clear status after 5 seconds
        setTimeout(() => setOfferStatus(''), 5000);
      }
    });

    return () => {
      console.log('🧹 Cleaning up WebRTC listeners');
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
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

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;

    if (!isWebRTCConnected) {
      alert('WebRTC connection required. Please connect first.');
      return;
    }

    const messageData: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sender: currentUser,
      content: messageInput.trim(),
      timestamp: new Date().toISOString()
    };

    // Send via WebRTC
    if (peerRef.current) {
      peerRef.current.send(JSON.stringify(messageData));
      
      // Add to local messages
      setMessages(prev => [...prev, messageData]);
      setMessageInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const connectWebRTC = () => {
    console.log('🔗 connectWebRTC called - current state:', { isConnecting, isWebRTCConnected });
    
    if (isConnecting || isWebRTCConnected) {
      console.log('⚠️ Already connecting or connected, ignoring request');
      return;
    }
    
    // Clean up any existing connection first
    if (peerRef.current) {
      console.log('🧹 Cleaning up existing peer before new connection');
      peerRef.current.destroy();
      peerRef.current = null;
    }
    
    // Determine who should initiate based on lexicographical order of usernames
    // This prevents race conditions by ensuring consistent initiator
    const shouldInitiate = currentUser < otherUser;
    console.log(`🎯 Connection logic: ${currentUser} vs ${otherUser} - shouldInitiate: ${shouldInitiate}`);
    
    console.log('🔗 WebRTC connection initiated');
    setOfferStatus('Establishing P2P connection...');
    initiatePeerConnection(shouldInitiate);
  };

  const disconnectWebRTC = () => {
    console.log('🔌 Disconnecting WebRTC');
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    setIsWebRTCConnected(false);
    setIsConnecting(false);
    setOfferStatus('');
    
    // Increment connection attempt to force listener re-setup
    setConnectionAttempt(prev => prev + 1);
    console.log('🔄 Incremented connection attempt for reconnection');
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
          {!isWebRTCConnected ? (
            <button
              onClick={connectWebRTC}
              disabled={isConnecting}
              className="bg-green-500 hover:bg-green-600 px-3 py-1 rounded flex items-center space-x-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Phone size={16} />
              <span>
                {isConnecting ? 'Connecting...' : 'Connect P2P'}
              </span>
            </button>
          ) : (
            <button
              onClick={disconnectWebRTC}
              className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded flex items-center space-x-1"
            >
              <PhoneOff size={16} />
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* Connection Status */}
      <div className="bg-gray-100 p-2 text-center text-sm">
        {isWebRTCConnected ? (
          <span className="text-green-600 flex items-center justify-center space-x-1">
            <Wifi size={16} />
            <span>Direct P2P connection active - messages stored locally</span>
          </span>
        ) : (
          <span className="text-orange-600 flex items-center justify-center space-x-1">
            <WifiOff size={16} />
            <span>No P2P connection - establish connection to send messages</span>
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
            placeholder={
              isWebRTCConnected 
                ? "Type your message..." 
                : "Connect WebRTC first to send messages"
            }
            disabled={!isWebRTCConnected}
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || !isWebRTCConnected}
            className="bg-blue-500 text-white p-2 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          💾 Messages are stored locally on your device only
        </p>
      </div>
    </div>
  );
}
