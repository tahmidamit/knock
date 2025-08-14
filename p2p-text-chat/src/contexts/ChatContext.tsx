'use client';

import { createContext, useContext, useReducer, useEffect, ReactNode, useState, useCallback } from 'react';
import { initSocket, getSocket } from '@/lib/socket';
import { ChatState, User, Invite, Message, Chat } from '@/types/chat';

interface ChatContextType {
  state: ChatState;
  initializeSocket: (token: string) => void;
  searchUsers: (searchTerm: string) => void;
  sendInvite: (toUsername: string) => void;
  respondToInvite: (inviteId: string, response: 'accept' | 'reject') => void;
  sendMessage: (chatId: string, message: string) => void;
  switchToChat: (chatId: string) => void;
  setCurrentSection: (section: 'invites' | 'chats') => void;
  currentSection: 'invites' | 'chats';
  logout: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

type Action =
  | { type: 'SET_CURRENT_USER'; payload: string }
  | { type: 'SET_ONLINE_USERS'; payload: User[] }
  | { type: 'ADD_USER'; payload: User }
  | { type: 'REMOVE_USER'; payload: string }
  | { type: 'SET_PENDING_INVITES'; payload: Invite[] }
  | { type: 'ADD_INVITE'; payload: Invite }
  | { type: 'REMOVE_INVITE'; payload: string }
  | { type: 'SET_ACTIVE_CHATS'; payload: Chat[] }
  | { type: 'ADD_CHAT'; payload: Chat }
  | { type: 'SET_CURRENT_CHAT'; payload: string | null }
  | { type: 'ADD_MESSAGE'; payload: { chatId: string; message: Message } }
  | { type: 'SET_CHAT_MESSAGES'; payload: { chatId: string; messages: Message[] } }
  | { type: 'UPDATE_SEARCH_RESULTS'; payload: User[] };

const initialState: ChatState = {
  currentUser: null,
  onlineUsers: [],
  pendingInvites: [],
  activeChats: [],
  currentChatId: null,
  messages: {},
};

function chatReducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };
    
    case 'SET_ONLINE_USERS':
      // Filter out current user and duplicates
      const filteredUsers = action.payload.filter((user, index, array) => 
        user.username !== state.currentUser && 
        array.findIndex(u => u.username === user.username) === index
      );
      return { ...state, onlineUsers: filteredUsers };
    
    case 'ADD_USER':
      // Only add if user doesn't exist and isn't current user
      if (action.payload.username === state.currentUser) return state;
      const userExists = state.onlineUsers.some(user => user.username === action.payload.username);
      if (userExists) return state;
      return {
        ...state,
        onlineUsers: [...state.onlineUsers, action.payload]
      };
    
    case 'REMOVE_USER':
      return {
        ...state,
        onlineUsers: state.onlineUsers.filter(user => user.username !== action.payload)
      };
    
    case 'SET_PENDING_INVITES':
      return { ...state, pendingInvites: action.payload };
    
    case 'ADD_INVITE':
      return {
        ...state,
        pendingInvites: [...state.pendingInvites, action.payload]
      };
    
    case 'REMOVE_INVITE':
      return {
        ...state,
        pendingInvites: state.pendingInvites.filter(invite => invite.id !== action.payload)
      };
    
    case 'SET_ACTIVE_CHATS':
      return { ...state, activeChats: action.payload };
    
    case 'ADD_CHAT':
      // Prevent duplicate chats
      const chatExists = state.activeChats.some(chat => chat.chatId === action.payload.chatId);
      if (chatExists) return state;
      return {
        ...state,
        activeChats: [...state.activeChats, action.payload]
      };
    
    case 'SET_CURRENT_CHAT':
      return { ...state, currentChatId: action.payload };
    
    case 'ADD_MESSAGE':
      const { chatId, message } = action.payload;
      return {
        ...state,
        messages: {
          ...state.messages,
          [chatId]: [...(state.messages[chatId] || []), message]
        }
      };
    
    case 'SET_CHAT_MESSAGES':
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.payload.chatId]: action.payload.messages
        }
      };
    
    case 'UPDATE_SEARCH_RESULTS':
      return { ...state, onlineUsers: action.payload };
    
    default:
      return state;
  }
}

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [currentSection, setCurrentSection] = useState<'invites' | 'chats'>('invites');

  const initializeSocket = useCallback((token: string) => {
    // Set current user from localStorage
    const username = localStorage.getItem('username');
    if (username) {
      dispatch({ type: 'SET_CURRENT_USER', payload: username });
    }
    
    const socket = initSocket(token);

    // Connection events
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    // User events
    socket.on('online-users', (users: User[]) => {
      dispatch({ type: 'SET_ONLINE_USERS', payload: users });
    });

    socket.on('user-joined', (user: User) => {
      dispatch({ type: 'ADD_USER', payload: user });
      
      // Update chat status if this user has a chat with current user
      setTimeout(() => {
        const socket = getSocket();
        if (socket) {
          socket.emit('get-active-chats');
        }
      }, 100);
    });

    socket.on('user-left', (data: { username: string }) => {
      dispatch({ type: 'REMOVE_USER', payload: data.username });
      
      // Update chat status if this user has a chat with current user
      setTimeout(() => {
        const socket = getSocket();
        if (socket) {
          socket.emit('get-active-chats');
        }
      }, 100);
    });

    socket.on('search-results', (users: User[]) => {
      dispatch({ type: 'UPDATE_SEARCH_RESULTS', payload: users });
    });

    // Invite events
    socket.on('new-invite', (invite: Invite) => {
      dispatch({ type: 'ADD_INVITE', payload: invite });
    });

    socket.on('pending-invites', (invites: Invite[]) => {
      dispatch({ type: 'SET_PENDING_INVITES', payload: invites });
    });

    socket.on('invite-accepted', (data: { username: string; chatId: string }) => {
      const newChat: Chat = {
        chatId: data.chatId,
        otherUser: data.username,
        otherUserId: data.username, // Using username as userId
        lastMessage: null,
        createdAt: new Date().toISOString(),
        isOtherUserOnline: false // Default to false, will be updated by online status
      };
      dispatch({ type: 'ADD_CHAT', payload: newChat });
      setCurrentSection('chats');
    });

    socket.on('invite-rejected', (data: { username: string }) => {
      console.log(`${data.username} rejected your invite`);
    });

    socket.on('invite-sent', (data: { toUsername: string }) => {
      console.log(`Invite sent to ${data.toUsername}`);
    });

    socket.on('invite-error', (error: string) => {
      alert(error);
    });

    // Chat events
    socket.on('active-chats', (chats: Chat[]) => {
      console.log('Received active chats:', chats);
      dispatch({ type: 'SET_ACTIVE_CHATS', payload: chats });
    });

    socket.on('new-message', (data: { chatId: string; message: Message }) => {
      dispatch({ type: 'ADD_MESSAGE', payload: data });
    });

    socket.on('message-sent', (data: { chatId: string; message: Message }) => {
      dispatch({ type: 'ADD_MESSAGE', payload: data });
    });

    // P2P message events (signaling only)
    socket.on('p2p-message', (data: { chatId: string; message: Message }) => {
      console.log('Received P2P message signal:', data);
      // This is just signaling - actual P2P messaging happens in P2PChatSection
    });

    socket.on('p2p-message-sent', (data: { chatId: string; message: Message }) => {
      console.log('P2P message sent signal:', data);
      // This is just signaling - actual P2P messaging happens in P2PChatSection
    });

    socket.on('chat-history', (data: { chatId: string; messages: Message[] }) => {
      dispatch({ type: 'SET_CHAT_MESSAGES', payload: data });
    });

    // Error handling
    socket.on('error', (error: string) => {
      console.error('Socket error:', error);
      alert(error);
    });
  }, [dispatch]); // Add dispatch to dependencies since we use it

  const logout = () => {
    const socket = getSocket();
    if (socket) {
      socket.disconnect();
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    window.location.reload();
  };

  const searchUsers = (searchTerm: string) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('search-users', searchTerm);
    }
  };

  const sendInvite = (toUsername: string) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('send-invite', { toUsername });
    }
  };

  const respondToInvite = (inviteId: string, response: 'accept' | 'reject') => {
    const socket = getSocket();
    if (socket) {
      socket.emit('respond-invite', { inviteId, response });
      dispatch({ type: 'REMOVE_INVITE', payload: inviteId });
    }
  };

  const sendMessage = (chatId: string, message: string) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('send-message', { chatId, message });
    }
  };

  const switchToChat = (chatId: string) => {
    dispatch({ type: 'SET_CURRENT_CHAT', payload: chatId });
    
    // Only get chat history if chatId is valid and not empty
    if (chatId && chatId.trim() !== '') {
      const socket = getSocket();
      if (socket) {
        socket.emit('get-chat-history', chatId);
      }
    }
  };

  useEffect(() => {
    // Get current user from localStorage when component mounts
    const username = localStorage.getItem('username');
    if (username) {
      dispatch({ type: 'SET_CURRENT_USER', payload: username });
    }
    
    if (state.currentUser) {
      const socket = getSocket();
      if (socket) {
        socket.emit('get-pending-invites');
        socket.emit('get-active-chats');
      }
    }
  }, [state.currentUser]);

  return (
    <ChatContext.Provider value={{
      state,
      initializeSocket,
      searchUsers,
      sendInvite,
      respondToInvite,
      sendMessage,
      switchToChat,
      setCurrentSection,
      currentSection,
      logout
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
