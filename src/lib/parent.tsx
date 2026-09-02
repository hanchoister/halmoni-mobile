import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { useFamily } from '@/lib/family';

const CURRENT_PARENT_STORAGE_KEY = 'halmoni:currentParentId';

// Mirrors the web app's shape exactly so the two never disagree about what a
// resuscitation preference means.
export type DnrStatus = 'unknown' | 'yes' | 'no' | 'see_document';

export type IceContact = { name: string; relation: string; phone: string };

export type HealthcareProxy = {
  name: string;
  phone: string;
  relation: string;
  email?: string;
};

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
  ice_contacts: IceContact[];
  pharmacy: { name: string; phone: string; address?: string } | null;
  primary_doctor: { name: string; phone: string } | null;
  insurance: {
    provider: string;
    memberId: string;
    groupId?: string;
    planName?: string;
    phone?: string;
  } | null;
  dnr_status: DnrStatus | null;
  healthcare_proxy: HealthcareProxy | null;
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

/** Cheap identity check: same rows, same versions, same order. */
function sameParents(a: ParentRow[], b: ParentRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].updated_at !== b[i].updated_at) return false;
  }
  return true;
}

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
    // list() returns fresh objects every call, so assigning unconditionally gave
    // `parents` — and therefore `currentParent` — a new identity on every sync
    // tick. currentParent sits in the dependency array of nearly every screen's
    // load(), so that churn re-ran all of them for no reason. Only replace state
    // when the rows have actually changed.
    setParents((prev) => (sameParents(prev, rows) ? prev : rows));
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
