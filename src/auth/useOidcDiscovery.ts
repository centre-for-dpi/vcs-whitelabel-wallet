import { useEffect, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import { oidcConfig } from '../../branding.config';

/**
 * Like AuthSession.useAutoDiscovery, but a no-op when OIDC is disabled.
 *
 * useAutoDiscovery(null) isn't allowed by its types, and at runtime
 * resolveDiscoveryAsync(null) fails an invariant inside an un-awaited promise
 * (unhandled rejection). Hooks can't be called conditionally, so the
 * enabled check has to live inside the hook.
 */
export function useOidcDiscovery(): AuthSession.DiscoveryDocument | null {
  const [discovery, setDiscovery] = useState<AuthSession.DiscoveryDocument | null>(null);

  useEffect(() => {
    if (!oidcConfig.enabled) return;
    let active = true;
    AuthSession.fetchDiscoveryAsync(oidcConfig.issuerUrl)
      .then((doc) => { if (active) setDiscovery(doc); })
      .catch(() => { /* leave null; sign-in button stays disabled */ });
    return () => { active = false; };
  }, []);

  return discovery;
}
