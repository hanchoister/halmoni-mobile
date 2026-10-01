import { Session } from '@supabase/supabase-js';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { useDemoMode } from '@/lib/demo-mode';
import { clearSessionIfFreshInstall } from '@/lib/security/fresh-install';
import { supabase } from '@/lib/supabase';

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const demoMode = useDemoMode();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Re-run when demoMode flips so the proxied supabase returns the right
    // session (real persisted session or the demo fake). Stale in-flight
    // promises from the previous mode are ignored via `cancelled`.
    let cancelled = false;
    // A session in the keychain can outlive the app being deleted, so clear it
    // before asking for it — otherwise getSession() reads the stale one and
    // signs a reinstalled app straight back into the family's record. Awaited,
    // not fired and forgotten, for exactly that reason. No-ops on every launch
    // but the first after an install.
    clearSessionIfFreshInstall()
      .then(() => supabase.auth.getSession())
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        // Never leave the app on the loading spinner. Treating an unreadable
        // session as "signed out" is the safe direction: it shows the sign-in
        // screen rather than hanging on a blank gate forever.
        if (cancelled) return;
        setSession(null);
        setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [demoMode]);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
