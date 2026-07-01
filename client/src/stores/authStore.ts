import { create } from 'zustand';
import type { User, AuthResponse } from '../types';
import { api, setToken, clearToken } from '../services/api';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => boolean;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const res = await api.post<AuthResponse>('/auth/login', { username, password });
      setToken(res.token);
      set({ user: res.user, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  register: async (username, password, displayName) => {
    set({ isLoading: true });
    try {
      const res = await api.post<AuthResponse>('/auth/register', { username, password, displayName });
      setToken(res.token);
      set({ user: res.user, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  logout: () => {
    clearToken();
    set({ user: null });
  },

  checkAuth: () => {
    const token = localStorage.getItem('token');
    return !!token;
  },
}));
