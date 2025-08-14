'use client';

import { useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Search, UserPlus, Check, X, LogOut } from 'lucide-react';

export default function InviteSection() {
  const {
    state,
    searchUsers,
    sendInvite,
    respondToInvite,
    setCurrentSection,
    logout
  } = useChat();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleSearch = () => {
    if (searchTerm.trim()) {
      searchUsers(searchTerm);
    }
  };

  const handleSendInvite = (username: string) => {
    sendInvite(username);
    setSearchTerm('');
    setSearchResults([]);
  };

  const handleAcceptInvite = (inviteId: string) => {
    respondToInvite(inviteId, 'accept');
  };

  const handleRejectInvite = (inviteId: string) => {
    respondToInvite(inviteId, 'reject');
  };

  return (
    <div className="h-full bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Invites</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentSection('chats')}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              Go to Chats
            </button>
            <button
              onClick={logout}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Search and Send Invites */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">
              Find Users
            </h2>
            
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by username..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Search
                </button>
              </div>

              {/* Search Results */}
              {state.onlineUsers.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-700">Online Users:</h3>
                  {state.onlineUsers.map((user) => (
                    <div
                      key={user.username}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-medium">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{user.username}</span>
                        <span className="text-xs text-green-500">● online</span>
                      </div>
                      <button
                        onClick={() => handleSendInvite(user.username)}
                        className="flex items-center gap-1 px-3 py-1 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
                      >
                        <UserPlus className="w-4 h-4" />
                        Invite
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pending Invites */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-700">
              Pending Invites ({state.pendingInvites.length})
            </h2>
            
            <div className="space-y-3">
              {state.pendingInvites.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No pending invites
                </p>
              ) : (
                state.pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 border-blue-500"
                  >
                    <div>
                      <p className="font-medium text-gray-800">
                        Invite from <span className="text-blue-600">{invite.from}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(invite.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptInvite(invite.id)}
                        className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        Accept
                      </button>
                      <button
                        onClick={() => handleRejectInvite(invite.id)}
                        className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
