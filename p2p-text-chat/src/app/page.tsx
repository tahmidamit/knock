'use client';

import { useState, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import LoginForm from '@/components/LoginForm';
import InviteSection from '@/components/InviteSection';
import ChatSection from '@/components/ChatSection';

export default function Home() {
  const { state, currentSection, initializeSocket } = useChat();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    // Check for stored authentication
    const token = localStorage.getItem('authToken');
    const username = localStorage.getItem('username');

    if (token && username) {
      setCurrentUser(username);
      setIsAuthenticated(true);
      initializeSocket(token);
    }
    
    setIsLoading(false);
  }, []); // Remove initializeSocket from dependencies

  const handleLogin = (username: string, token: string) => {
    setCurrentUser(username);
    setIsAuthenticated(true);
    initializeSocket(token);
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen">
      {/* Show both sections together in a combined view */}
      <div className="h-full bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">P2P Chat & Invites</h1>
            <button
              onClick={() => {
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
                setIsAuthenticated(false);
                setCurrentUser(null);
              }}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
            >
              <span>Logout</span>
            </button>
          </div>

          {/* Combined Chat and Invite Sections */}
          <div className="grid lg:grid-cols-4 gap-6">
            {/* Chat Section - Left Side (Takes up 3 columns) */}
            <div className="lg:col-span-3">
              <ChatSection />
            </div>
            
            {/* Invite Section - Right Side (Takes up 1 column) */}
            <div className="lg:col-span-1">
              <InviteSection />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}