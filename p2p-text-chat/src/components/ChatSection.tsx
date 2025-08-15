'use client';

import { useState, useEffect, useRef } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Send, ArrowLeft, MessageCircle, LogOut } from 'lucide-react';
import P2PChatSection from './P2PChatSection';
import { getSocket } from '@/lib/socket';

export default function ChatSection() {
  const {
    state,
    sendMessage,
    switchToChat
  } = useChat();
  
  const [messageInput, setMessageInput] = useState('');
  const [showP2PChat, setShowP2PChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentChat = state.activeChats.find(chat => chat.chatId === state.currentChatId);
  const currentMessages = state.currentChatId ? state.messages[state.currentChatId] || [] : [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages]);

  const handleSendMessage = () => {
    if (messageInput.trim() && state.currentChatId) {
      sendMessage(state.currentChatId, messageInput.trim());
      setMessageInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // If P2P chat is active, render the P2P component in full screen
  if (currentChat && showP2PChat) {
    const socket = getSocket();
    return (
      <div className="fixed inset-0 z-50">
        <P2PChatSection
          socket={socket}
          currentUser={state.currentUser || ''}
          chatId={currentChat.chatId}
          otherUser={currentChat.otherUser}
          otherUserId={currentChat.otherUserId}
          onBack={() => setShowP2PChat(false)}
        />
      </div>
    );
  }

  if (!currentChat) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-700">
          Active Chats ({state.activeChats.length})
        </h2>

        <div className="space-y-3">
          {state.activeChats.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No active chats. Send some invites to start chatting!
            </p>
          ) : (
            state.activeChats.map((chat) => (
              <div
                key={chat.chatId}
                onClick={() => switchToChat(chat.chatId)}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors bg-gray-50 hover:bg-gray-100 cursor-pointer`}
              >
                <div className="relative">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                    {chat.otherUser.charAt(0).toUpperCase()}
                  </div>
                  {/* Online status indicator */}
                  <div
                    className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${
                      chat.isOtherUserOnline ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-800 truncate">
                      {chat.otherUser}
                    </p>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        chat.isOtherUserOnline
                          ? 'bg-green-100 text-green-600'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {chat.isOtherUserOnline ? 'online' : 'offline'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate">
                    Click to start P2P chat
                  </p>
                </div>
                <MessageCircle 
                  className={`w-5 h-5 ${
                    chat.isOtherUserOnline ? 'text-gray-400' : 'text-gray-300'
                  }`} 
                />
              </div>
            ))
          )}
        </div>
        
        {/* Empty state message when no chats are selected */}
        <div className="mt-8 text-center">
          <MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">
            Select a chat above to start messaging
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md flex flex-col h-[600px]">
      {/* Header */}
      <div className="p-4 border-b flex items-center gap-3">
        <button
          onClick={() => switchToChat('')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
          {currentChat.otherUser.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-gray-800">{currentChat.otherUser}</h2>
          <p className="text-sm text-green-500">🔗 P2P WebRTC Chat</p>
        </div>
      </div>

      {/* P2P Chat Instructions */}
      <div className="flex-1 p-6 flex items-center justify-center">
        <div className="text-center max-w-sm">
          <MessageCircle className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-3 text-gray-800">WebRTC P2P Chat</h3>
          <p className="text-gray-600 mb-4 leading-relaxed text-sm">
            This chat uses WebRTC for direct peer-to-peer messaging. 
            Messages are stored locally on your device only.
          </p>
          <div className="bg-blue-50 p-3 rounded-lg mb-4">
            <p className="text-sm text-blue-800 font-medium">
              ✨ Features:
            </p>
            <ul className="text-sm text-blue-700 mt-2 text-left">
              <li>• Direct P2P connection</li>
              <li>• No server message storage</li>
              <li>• Local message history</li>
              <li>• Real-time communication</li>
            </ul>
          </div>
          
          {/* Start Chat Button */}
          <button
            onClick={() => setShowP2PChat(true)}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-6 rounded-lg transition-colors mb-4"
          >
            🚀 Start P2P Chat
          </button>
          
          <p className="text-xs text-gray-500">
            Chat ID: {currentChat.chatId}
          </p>
        </div>
      </div>
    </div>
  );
}
