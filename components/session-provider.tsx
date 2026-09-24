"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ClientSession = {
  authenticated: boolean;
  oidcConfigured: boolean;
  navigationCapabilities?: string[];
  user?: {
    id: string;
    displayName: string;
    email: string | null;
    role: string;
    tenantId: string;
    tenantName?: string | null;
    employmentId?: string | null;
    expiresAt?: string;
  };
};

type SessionContextValue = {
  session: ClientSession | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSession(await response.json() as ClientSession);
    } catch {
      setSession({ authenticated: false, oidcConfigured: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ session, loading, refresh }), [loading, refresh, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSessionContext must be used inside SessionProvider");
  return value;
}
