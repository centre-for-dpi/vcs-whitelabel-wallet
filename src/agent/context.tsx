import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { setupAgent, WalletAgent } from './setup';
import { getWalletKey } from '../utils/storage';

type AgentState =
  | { status: 'loading' }
  | { status: 'uninitialized' }
  | { status: 'ready'; agent: WalletAgent }
  | { status: 'error'; message: string };

const AgentContext = createContext<AgentState>({ status: 'loading' });

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AgentState>({ status: 'loading' });
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    boot();
  }, []);

  const boot = async () => {
    try {
      const key = await getWalletKey();
      if (!key) {
        setState({ status: 'uninitialized' });
        return;
      }
      const agent = await setupAgent(key);
      setState({ status: 'ready', agent });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', message });
    }
  };

  return <AgentContext.Provider value={state}>{children}</AgentContext.Provider>;
};

export const useAgentState = () => useContext(AgentContext);

export const useAgent = (): WalletAgent => {
  const state = useContext(AgentContext);
  if (state.status !== 'ready') throw new Error('Agent not ready');
  return state.agent;
};

// Call this after PIN setup to initialize the agent with the new key
export const initAgent = async (
  key: string,
  setState: React.Dispatch<React.SetStateAction<AgentState>>,
) => {
  setState({ status: 'loading' });
  try {
    const agent = await setupAgent(key);
    setState({ status: 'ready', agent });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    setState({ status: 'error', message });
  }
};
