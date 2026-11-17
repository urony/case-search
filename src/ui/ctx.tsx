import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
  // בשירות אמיתי הספירות מגיעות מהקטלוג (קריאה אחת); בהדגמה ובבדיקות נטענים כל המקורות המקומיים.
  const loadSources = useCallback(() => {
    if (catalog?.origin === 'service') { setCounts(catalog.sourceCounts ?? {}); return; }
    if (api.mode === 'service') { setCounts({}); return; }
    api.listSources().then(ss => {
      const c: Record<string, number> = {};
      ss.forEach(s => { c[s.topicId] = (c[s.topicId] ?? 0) + 1; });
      setCounts(c);
    }).catch(() => setCounts({}));
  }, [api, catalog]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSources(); }, [loadSources]);
  const index = useMemo(() => buildIndex(catalog?.topics ?? []), [catalog]);
  const topicById = useMemo(() => new Map((catalog?.topics ?? []).map(t => [t.id, t])), [catalog]);
  return <CatalogCtx.Provider value={{ catalog, loading, error, reload: load, index, topicById, sourceCounts: counts, reloadSources: loadSources }}>{children}</CatalogCtx.Provider>;
}

export interface Badges { admin: { openRequests: number; inProgress: number; unreviewedSources: number; openReports: number; openSuggestions: number; overdue: number; total: number } | null; unseenReplies: number }
interface SessionState { ctx: Ctx; refresh: () => Promise<void>; badges: Badges; refreshBadges: (force?: boolean) => void }
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

  // חיווי "דורש טיפול" בתוך המערכת (במקום דוא"ל). נטען בכניסה ובכל מעבר דף, לכל היותר פעם בדקה, כדי לחסוך קריאות.
  const [badges, setBadges] = useState<Badges>({ admin: null, unseenReplies: 0 });
  const last = useRef(0);
  const refreshBadges = useCallback((force = false) => {
    if (!ctx.user || !ctx.verified) { setBadges({ admin: null, unseenReplies: 0 }); return; }
    const t = Date.now();
    if (!force && t - last.current < 60_000) return;
    last.current = t;
    Promise.all([ctx.role === 'admin' ? api.adminBadges() : Promise.resolve(null), api.myUnseenReplies()])
      .then(([admin, unseenReplies]) => setBadges({ admin, unseenReplies }))
      .catch(() => {});
  }, [api, ctx.user, ctx.verified, ctx.role]);
  useEffect(() => { last.current = 0; refreshBadges(true); }, [refreshBadges]);
  return <SessionCtx.Provider value={{ ctx, refresh, badges, refreshBadges }}>{children}</SessionCtx.Provider>;
}
