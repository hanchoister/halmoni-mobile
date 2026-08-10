import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { useFamily } from '@/lib/family';

const CURRENT_PARENT_STORAGE_KEY = 'halmoni:currentParentId';

export type ParentRow = {
  id: string;
  family_id: string;
  name: string;
  nickname: string | null;
  photo_url: string | null;
  dob: string | null;
  conditions: string[];
  allergies: string[];
  preferences: string | null;
  blood_type: string | null;
  ice_contacts: { name: string; relation: string; phone: string }[];
  pharmacy: { name: string; phone: string; address?: string } | null;
  primary_doctor: { name: string; phone: string } | null;
  insurance: {
    provider: string;
    memberId: string;
    groupId?: string;
    planName?: string;
    phone?: string;
  } | null;
  created_at: string;
  updated_at: string;
};

type ParentState = {
  parents: ParentRow[];
  currentParent: ParentRow | null;
  loading: boolean;
  setCurrentParentId: (id: string) => void;
  refresh: () => Promise<void>;
};

const ParentContext = createContext<ParentState>({
  parents: [],
  currentParent: null,
  loading: true,
  setCurrentParentId: () => {},
  refresh: async () => {},
});

export function ParentProvider({ children }: { children: ReactNode }) {
  const { familyId } = useFamily();
  const dataVersion = useDataVersion();
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentParentId, setCurrentParentIdState] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CURRENT_PARENT_STORAGE_KEY).then((v) => {
      if (v) setCurrentParentIdState(v);
    });
  }, []);

  const setCurrentParentId = useCallback((id: string) => {
    setCurrentParentIdState(id);
    AsyncStorage.setItem(CURRENT_PARENT_STORAGE_KEY, id).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!familyId) {
      setParents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = (await list('parents', { family_id: familyId }, {
      orderBy: 'created_at ASC',
    })) as ParentRow[];
    setParents(rows);
    setLoading(false);
  }, [familyId]);

  useEffect(() => {
    refresh();
  }, [refresh, dataVersion]);

  const currentParent = useMemo(() => {
    if (parents.length === 0) return null;
    const match = parents.find((p) => p.id === currentParentId);
    return match ?? parents[0];
  }, [parents, currentParentId]);

  return (
    <ParentContext.Provider
      value={{ parents, currentParent, loading, setCurrentParentId, refresh }}>
      {children}
    </ParentContext.Provider>
  );
}

export function useParents() {
  return useContext(ParentContext);
}
