import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Catalog, Topic } from '../domain/types';
import { buildIndex } from '../domain/search';
import type { Ctx } from '../services/api';
import type { Runtime } from '../services/runtime';

export const RuntimeCtx = createContext<Runtime>(null as unknown as Runtime);
export const useRT = () => useContext(RuntimeCtx);

interface CatalogState {
  catalog: Catalog | null; loading: boolean; error: string | null; reload: () => void;
  index: ReturnType<typeof buildIndex>; topicById: Map<string, Topic>; sourceCounts: Record<string, number>; reloadSources: () => void;
}
const CatalogCtx = createContext<CatalogState>(null as unknown as CatalogState);
export const useCatalog = () => useContext(CatalogCtx);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { api } = useRT();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.loadCatalog().then(setCatalog).catch(e => setError(String(e?.message ?? e))).finally(() => setLoading(false));
  }, [api]);
  const loadSources = useCallback(() => {
    api.listSources().then(ss => {
      const c: Record<string, number> = {};
      ss.forEach(s => { c[s.topicId] = (c[s.topicId] ?? 0) + 1; });
      setCounts(c);
    }).catch(() => setCounts({}));
  }, [api]);
  useEffect(() => { load(); loadSources(); }, [load, loadSources]);
  const index = useMemo(() => buildIndex(catalog?.topics ?? []), [catalog]);
  const topicById = useMemo(() => new Map((catalog?.topics ?? []).map(t => [t.id, t])), [catalog]);
  return <CatalogCtx.Provider value={{ catalog, loading, error, reload: load, index, topicById, sourceCounts: counts, reloadSources: loadSources }}>{children}</CatalogCtx.Provider>;
}

interface SessionState { ctx: Ctx; refresh: () => Promise<void> }
const SessionCtx = createContext<SessionState>(null as unknown as SessionState);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api, auth } = useRT();
  const [ctx, setCtx] = useState<Ctx>({ user: null, role: null, roleDoc: null, verified: false });
  const refresh = useCallback(async () => {
    const c = await api.ctx();
    setCtx(c);
    if (c.user) api.ensureProfile().catch(() => {});
  }, [api]);
  useEffect(() => auth.subscribe(() => { refresh(); }), [auth, refresh]);
  return <SessionCtx.Provider value={{ ctx, refresh }}>{children}</SessionCtx.Provider>;
}
