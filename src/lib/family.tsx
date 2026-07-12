import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type FamilyState = {
  familyId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const FamilyContext = createContext<FamilyState>({
  familyId: null,
  loading: true,
  refresh: async () => {},
});

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session?.user) {
      setFamilyId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('family_members')
      .select('family_id')
      .eq('user_id', session.user.id)
      .limit(1);
    setFamilyId(data && data.length > 0 ? data[0].family_id : null);
    setLoading(false);
  }, [session?.user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <FamilyContext.Provider value={{ familyId, loading, refresh }}>
      {children}
    </FamilyContext.Provider>
  );
}

export function useFamily() {
  return useContext(FamilyContext);
}
