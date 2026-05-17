import * as AuthSession from 'expo-auth-session';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { oidcConfig } from '../../branding.config';
import {
  OidcUser,
  clearOidcTokens,
  clearOidcUser,
  getOidcRefreshToken,
  getOidcUser,
  isOidcTokenExpired,
  saveOidcTokens,
  saveOidcUser,
} from '../utils/storage';

type UserContextType = {
  user: OidcUser | null;
  setUser: (user: OidcUser) => Promise<void>;
  clearUser: () => Promise<void>;
  /** Silently refresh the OIDC token. Returns true if the session is still valid. */
  refreshUser: () => Promise<boolean>;
};

const UserContext = createContext<UserContextType>({
  user: null,
  setUser: async () => {},
  clearUser: async () => {},
  refreshUser: async () => false,
});

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<OidcUser | null>(null);

  const setUser = async (u: OidcUser) => {
    await saveOidcUser(u);
    setUserState(u);
  };

  const clearUser = async () => {
    // Attempt server-side token revocation before clearing local state.
    // Failures are silently ignored — local logout always completes.
    if (oidcConfig.enabled) {
      const refreshToken = await getOidcRefreshToken().catch(() => null);
      if (refreshToken) {
        AuthSession.fetchDiscoveryAsync(oidcConfig.issuerUrl)
          .then((discovery) => {
            const revocationEndpoint = (discovery as unknown as Record<string, string>).revocationEndpoint;
            if (!revocationEndpoint) return;
            return fetch(revocationEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                token: refreshToken,
                token_type_hint: 'refresh_token',
                client_id: oidcConfig.clientId,
              }).toString(),
            });
          })
          .catch(() => {});
      }
    }
    await clearOidcUser();
    await clearOidcTokens();
    setUserState(null);
  };

  const refreshUser = useCallback(async (): Promise<boolean> => {
    if (!oidcConfig.enabled) return false;
    const refreshToken = await getOidcRefreshToken();
    if (!refreshToken) return false;
    const expired = await isOidcTokenExpired();
    if (!expired) return true; // still valid

    try {
      const discovery = await AuthSession.fetchDiscoveryAsync(oidcConfig.issuerUrl);
      if (!discovery.tokenEndpoint) return false;

      const tokenResp = await AuthSession.refreshAsync(
        { clientId: oidcConfig.clientId, refreshToken },
        discovery,
      );

      await saveOidcTokens(tokenResp.refreshToken ?? refreshToken, tokenResp.expiresIn);

      if (discovery.userInfoEndpoint) {
        const resp = await fetch(discovery.userInfoEndpoint, {
          headers: { Authorization: `Bearer ${tokenResp.accessToken}` },
        });
        if (resp.ok) {
          const info = await resp.json() as Record<string, string>;
          const oidcUser: OidcUser = {
            sub: info.sub,
            name: info.name,
            given_name: info.given_name,
            family_name: info.family_name,
            email: info.email,
          };
          await saveOidcUser(oidcUser);
          setUserState(oidcUser);
        }
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    getOidcUser().then((u) => {
      setUserState(u);
      if (u && oidcConfig.enabled) {
        refreshUser().catch(() => {}); // silent background refresh
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser, clearUser, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
