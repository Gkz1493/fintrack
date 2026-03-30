import { createContext, useContext, useState, useEffect } from 'react';
import { getMe } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token    = localStorage.getItem('ft_token');
    const stored   = localStorage.getItem('ft_user');
    if (token && stored) {
      setUser(JSON.parse(stored));
      getMe().then(r => {
        setUser(r.data);
        localStorage.setItem('ft_user', JSON.stringify(r.data));
      }).catch(() => {
        localStorage.removeItem('ft_token');
        localStorage.removeItem('ft_user');
        setUser(null);
      }).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const signIn = ({ token, user: u }) => {
    localStorage.setItem('ft_token', token);
    localStorage.setItem('ft_user', JSON.stringify(u));
    setUser(u);
  };

  const signOut = () => {
    localStorage.removeItem('ft_token');
    localStorage.removeItem('ft_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
