import { useState, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

interface UseMessageManagementProps {
  chatId: string;
  currentUser: string;
}

export const useMessageManagement = ({ chatId, currentUser }: UseMessageManagementProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const storageKey = `chat_${chatId}_messages`;

  // Load messages from localStorage on component mount
  useEffect(() => {
    const savedMessages = localStorage.getItem(storageKey);
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages));
      } catch (error) {
        console.error('Error loading saved messages:', error);
        setMessages([]);
      }
    }
  }, [storageKey]);

  // Save messages to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => {
      // Check if message already exists (prevent duplicates)
      const exists = prev.some(m => m.id === message.id);
      if (exists) return prev;
      
      return [...prev, message];
    });
  }, []);

  const sendMessage = useCallback((
    content: string,
    socket: any,
    sendP2PMessage: (message: any) => boolean
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!content.trim()) {
        resolve(false);
        return;
      }

      const message: Message = {
        id: `${Date.now()}-${Math.random()}`,
        sender: currentUser,
        content: content.trim(),
        timestamp: new Date().toISOString()
      };

      // Add to local messages immediately for optimistic update
      addMessage(message);

      // Try P2P first, fallback to socket
      const p2pSent = sendP2PMessage(message);
      
      if (p2pSent) {
        console.log('📨 Message sent via P2P');
        resolve(true);
      } else {
        console.log('📡 Falling back to socket message');
        socket.emit('send-message', {
          chatId,
          content: content.trim(),
          sender: currentUser,
          messageId: message.id
        });
        resolve(true);
      }
    });
  }, [currentUser, chatId, addMessage]);

  const handleReceivedMessage = useCallback((data: any) => {
    if (data.chatId === chatId) {
      const message: Message = {
        id: data.messageId || `${Date.now()}-${Math.random()}`,
        sender: data.sender,
        content: data.content,
        timestamp: data.timestamp || new Date().toISOString()
      };
      
      addMessage(message);
      console.log('📨 Message received via socket:', message);
    }
  }, [chatId, addMessage]);

  const handleP2PMessage = useCallback((messageData: any) => {
    if (messageData.chatId === chatId) {
      const message: Message = {
        id: messageData.id,
        sender: messageData.sender,
        content: messageData.content,
        timestamp: messageData.timestamp
      };
      
      addMessage(message);
      console.log('📨 Message received via P2P:', message);
    }
  }, [chatId, addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    messages,
    addMessage,
    sendMessage,
    handleReceivedMessage,
    handleP2PMessage,
    clearMessages
  };
};
