import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStore(await api.getStore());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Every mutation re-reads the server copy so the UI can never drift from disk.
  const mutate = useCallback(
    async (fn) => {
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (err) {
        setError(err.message);
        throw err;
      }
    },
    [refresh]
  );

  const value = { store, error, refresh, mutate, setError };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
