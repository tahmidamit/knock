const API_BASE_URL = typeof window !== 'undefined' 
  ? `http://${window.location.hostname}:3000`
  : 'http://localhost:3000';

export interface AuthResponse {
  message: string;
  token: string;
  user: {
    id: string;
    username: string;
  };
}

export interface AuthError {
  error: string;
}

export const authAPI = {
  register: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    return data;
  },

  login: async (username: string, password: string): Promise<AuthResponse> => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    return data;
  },
};
