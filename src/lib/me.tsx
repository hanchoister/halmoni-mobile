import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useFamily } from '@/lib/family';
import { supabase } from '@/lib/supabase';
import type { MemberColor } from '@/lib/theme';

export type FamilyMember = {
  id: string;
  family_id: string;
  user_id: string;
  name: string;
  relation: string | null;
  phone: string | null;
  color: MemberColor;
  photo_url: string | null;
  is_owner: boolean;
  created_at: string;
};

type MeState = {
  me: FamilyMember | null;
  siblings: FamilyMember[];
  loading: boolean;
  refresh: () => Promise<void>;
};

const MeContext = createContext<MeState>({
  me: null,
  siblings: [],
  loading: true,
  refresh: async () => {},
});

export function MeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { familyId } = useFamily();
  const [siblings, setSiblings] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!familyId) {
      setSiblings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('family_members')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });
    setSiblings((data as FamilyMember[] | null) ?? []);
    setLoading(false);
  }, [familyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const me = siblings.find((m) => m.user_id === session?.user?.id) ?? null;

  return (
    <MeContext.Provider value={{ me, siblings, loading, refresh }}>
      {children}
    </MeContext.Provider>
  );
}

export function useMe() {
  return useContext(MeContext);
}
