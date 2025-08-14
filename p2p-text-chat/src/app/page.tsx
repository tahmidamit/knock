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
      {currentSection === 'invites' ? <InviteSection /> : <ChatSection />}
    </div>
  );
}