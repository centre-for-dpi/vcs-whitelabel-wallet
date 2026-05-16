import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { setupAgent, WalletAgent } from './setup';

type AgentState =
  | { status: 'loading' }
  | { status: 'uninitialized' }
  | { status: 'ready'; agent: WalletAgent }
  | { status: 'error'; message: string };

type AgentContextValue = {
  state: AgentState;
  initializeAgent: (key: string) => Promise<void>;
};

const AgentContext = createContext<AgentContextValue>({
  state: { status: 'loading' },
  initializeAgent: async () => {},
});

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AgentState>({ status: 'loading' });
  const initialized = useRef(false);

  React.useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Never auto-initialize — the user must authenticate via PIN or OIDC every cold start.
    setState({ status: 'uninitialized' });
  }, []);

  const initializeAgent = useCallback(async (key: string) => {
    setState({ status: 'loading' });
    try {
      const agent = await setupAgent(key);
      setState({ status: 'ready', agent });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', message });
      // Re-throw so callers (unlock screen) can surface the error locally
      // instead of navigating away while the agent is in error state.
      throw e;
    }
  }, []);

  return (
    <AgentContext.Provider value={{ state, initializeAgent }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgentState = () => useContext(AgentContext).state;

export const useAgent = (): WalletAgent => {
  const { state } = useContext(AgentContext);
  if (state.status !== 'ready') throw new Error('Agent not ready');
  return state.agent;
};

export const useInitializeAgent = () => useContext(AgentContext).initializeAgent;
