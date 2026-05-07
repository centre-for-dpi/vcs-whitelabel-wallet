import React, { createContext, useContext, useEffect, useState } from 'react';
import { OidcUser, clearOidcUser, getOidcUser, saveOidcUser } from '../utils/storage';

type UserContextType = {
  user: OidcUser | null;
  setUser: (user: OidcUser) => Promise<void>;
  clearUser: () => Promise<void>;
};

const UserContext = createContext<UserContextType>({
  user: null,
  setUser: async () => {},
  clearUser: async () => {},
});

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<OidcUser | null>(null);

  useEffect(() => {
    getOidcUser().then(setUserState);
  }, []);

  const setUser = async (u: OidcUser) => {
    await saveOidcUser(u);
    setUserState(u);
  };

  const clearUser = async () => {
    await clearOidcUser();
    setUserState(null);
  };

  return (
    <UserContext.Provider value={{ user, setUser, clearUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
