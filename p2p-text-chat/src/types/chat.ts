export interface User {
  username: string;
  status: 'online' | 'offline';
}

export interface Invite {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: string;
}

export interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

export interface Chat {
  chatId: string;
  otherUser: string;
  otherUserId: string;
  isOtherUserOnline: boolean;
  lastMessage: Message | null;
  createdAt: string;
}

export interface ChatState {
  currentUser: string | null;
  onlineUsers: User[];
  searchResults: User[];
  pendingInvites: Invite[];
  activeChats: Chat[];
  currentChatId: string | null;
  messages: { [chatId: string]: Message[] };
}
