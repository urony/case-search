import { DEFAULT_GENERAL_RULES } from '../engine/general';
import type { RuleSet } from '../engine/types';
import type { AcademicYear, CatalogMeta, NewItem, PublicSource, RecruitmentSource, Settings, SystemDef, TagDef, Topic } from '../domain/types';
import { DEFAULT_TAGS, defaultSettings, defaultYears, SEED_AUX } from './bundled';
import type { BatchOp, Store } from './store';

export const CATALOG_CHUNK = 120;
export const SOURCE_CHUNK = 150;

export function toPublicSource(s: RecruitmentSource): PublicSource {
  return { id: s.id, topicId: s.topicId, title: s.title, kind: s.kind, text: s.text, url: s.url, ...(s.links?.length ? { links: s.links } : {}), phone: s.phone, region: s.region, population: s.population, createdAt: s.createdAt };
}

/**
 * בונה את פעולות הכתיבה לעותק הציבורי. העותק כולל מידע ציבורי בלבד:
 *  - נושאים שפורסמו (לא טיוטות), במסמכים מקובצים;
 *  - מקורות איתור גלויים, ללא מזהי משתמש וללא מצב בדיקה פנימי;
 *  - פריטי "מה נוסף השנה" שמנהל סימן כגלויים;
 *  - הגדרות ציבוריות (בלי כתובת האחראי), מילון מערכות, כלל הסף ושנות לימוד.
 * הכול נכתב בפעולה אחת (batch אטומי): או שהעותק כולו מתעדכן או שהוא נשאר כפי שהיה.
 * המסמך הראשי (catalogMeta) כולל הכול חוץ מהנושאים והמקורות, כך שביקור של אורח עולה קריאה אחת כשהעותק המקומי עדכני.
 */
export async function buildCatalogOps(store: Store, now: number): Promise<{ ops: BatchOp[]; topics: number; chunks: number; sources: number; newItems: number }> {
  const topics = (await store.list<Topic>('topics', [['publish', '==', 'published']])).sort((a, b) => a.he.localeCompare(b.he, 'he'));
  const chunks = Math.max(1, Math.ceil(topics.length / CATALOG_CHUNK));
  const visibleSources = (await store.list<RecruitmentSource>('sources', [['visible', '==', true]])).sort((a, b) => a.createdAt - b.createdAt);
  const published = new Set(topics.map(t => t.id));
  // מקור של נושא שאינו מפורסם אינו נכלל (אין לאן להציג אותו)
  const sources = visibleSources.filter(s => published.has(s.topicId));
  const sourceCounts: Record<string, number> = {};
  for (const s of sources) sourceCounts[s.topicId] = (sourceCounts[s.topicId] ?? 0) + 1;
  const sourceChunks = Math.ceil(sources.length / SOURCE_CHUNK);
  const newItems = (await store.list<NewItem>('newItems', [['visible', '==', true]]))
    .map(({ createdBy: _c, ...rest }) => rest as NewItem)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  const [general, vocab, settings, years, old] = await Promise.all([
    store.get<{ rules: RuleSet }>('config/general'),
    store.get<{ systems: SystemDef[]; tags: TagDef[] }>('config/vocab'),
    store.get<Settings>('config/settings'),
    store.get<{ years: AcademicYear[] }>('config/years'),
    store.get<{ chunks: number; sourceChunks?: number }>('public/catalogMeta'),
  ]);

  const ops: BatchOp[] = [];
  for (let i = 0; i < chunks; i++) ops.push({ op: 'set', path: `public/catalog_${i}`, data: { topics: topics.slice(i * CATALOG_CHUNK, (i + 1) * CATALOG_CHUNK) } });
  for (let i = chunks; i < (old?.chunks ?? 0); i++) ops.push({ op: 'delete', path: `public/catalog_${i}` });
  for (let i = 0; i < sourceChunks; i++) ops.push({ op: 'set', path: `public/sources_${i}`, data: { sources: sources.slice(i * SOURCE_CHUNK, (i + 1) * SOURCE_CHUNK).map(toPublicSource) } });
  for (let i = sourceChunks; i < (old?.sourceChunks ?? 0); i++) ops.push({ op: 'delete', path: `public/sources_${i}` });
  // הגדרות ציבוריות בלבד: כתובת האחראי נשמרת בנפרד ואינה נכנסת לעותק
  const pubSettings: Settings = { ...defaultSettings(new Date(now)), ...(settings ?? {}), responsibleEmail: '', responsibleName: '' };
  const meta: CatalogMeta = {
    chunks, sourceChunks, generatedAt: now, sourceCounts,
    general: general?.rules ?? DEFAULT_GENERAL_RULES,
    vocab: { systems: vocab?.systems ?? SEED_AUX.systems, tags: vocab?.tags ?? DEFAULT_TAGS },
    settings: pubSettings,
    years: years?.years ?? defaultYears(new Date(now)),
    newItems,
  };
  ops.push({ op: 'set', path: 'public/catalogMeta', data: meta });
  return { ops, topics: topics.length, chunks, sources: sources.length, newItems: newItems.length };
}

/** קורא את מסמכי העותק הציבורי (נושאים ומקורות) לפי המסמך הראשי. המסמכים נקראים במקביל. */
export async function readSnapshotDocs(store: Store, meta: CatalogMeta): Promise<{ topics: Topic[]; sources: PublicSource[] }> {
  const [tc, sc] = await Promise.all([
    Promise.all(Array.from({ length: meta.chunks }, (_, i) => store.get<{ topics: Topic[] }>(`public/catalog_${i}`))),
    Promise.all(Array.from({ length: meta.sourceChunks ?? 0 }, (_, i) => store.get<{ sources: PublicSource[] }>(`public/sources_${i}`))),
  ]);
  return { topics: tc.flatMap(c => c?.topics ?? []), sources: sc.flatMap(c => c?.sources ?? []) };
}

export interface PublishDiff {
  /** false: אין עותק ציבורי כלל (טרם פורסם) */
  published: boolean;
  liveGeneratedAt: number | null;
  upToDate: boolean;
  topics: { added: string[]; removed: string[]; changed: string[] };
  sources: { added: number; removed: number; changed: number };
  newItems: { added: string[]; removed: string[]; changed: string[] };
  otherChanged: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * משווה את מה שיפורסם עכשיו (לפי תוכן המאגר הראשי) למה שמוצג בפועל לציבור.
 * נועד לתצוגה מקדימה לפני פרסום, וכדי שהמנהל ידע אם יש שינויים שטרם פורסמו.
 */
export async function diffAgainstLive(store: Store, now: number): Promise<PublishDiff> {
  const built = await buildCatalogOps(store, now);
  const setDoc = (path: string) => (built.ops.find(o => o.op === 'set' && o.path === path) as { data: any } | undefined)?.data;
  const draftMeta = setDoc('public/catalogMeta') as CatalogMeta;
  const draftTopics: Topic[] = Array.from({ length: built.chunks }, (_, i) => setDoc(`public/catalog_${i}`).topics as Topic[]).flat();
  const draftSources: PublicSource[] = Array.from({ length: draftMeta.sourceChunks ?? 0 }, (_, i) => setDoc(`public/sources_${i}`).sources as PublicSource[]).flat();
  const liveMeta = await store.get<CatalogMeta>('public/catalogMeta');
  const empty = { added: [] as string[], removed: [] as string[], changed: [] as string[] };
  if (!liveMeta) {
    return {
      published: false, liveGeneratedAt: null, upToDate: false,
      topics: { ...empty, added: draftTopics.map(t => t.he) }, sources: { added: draftSources.length, removed: 0, changed: 0 },
      newItems: { ...empty, added: (draftMeta.newItems ?? []).map(n => n.title) }, otherChanged: true,
    };
  }
  const live = await readSnapshotDocs(store, liveMeta);
  const cmp = <T extends { id: string }>(l: T[], d: T[], label: (x: T) => string) => {
    const lm = new Map(l.map(x => [x.id, x])), dm = new Map(d.map(x => [x.id, x]));
    return {
      added: d.filter(x => !lm.has(x.id)).map(label),
      removed: l.filter(x => !dm.has(x.id)).map(label),
      changed: d.filter(x => lm.has(x.id) && !same(lm.get(x.id), x)).map(label),
    };
  };
  const topics = cmp(live.topics, draftTopics, t => t.he);
  const s = cmp(live.sources, draftSources, x => x.title);
  const newItems = cmp(liveMeta.newItems ?? [], draftMeta.newItems ?? [], n => n.title);
  const otherChanged = !same(liveMeta.settings, draftMeta.settings) || !same(liveMeta.general, draftMeta.general) || !same(liveMeta.vocab, draftMeta.vocab) || !same(liveMeta.years, draftMeta.years);
  const upToDate = !otherChanged && [topics, s, newItems].every(x => x.added.length + x.removed.length + x.changed.length === 0);
  return {
    published: true, liveGeneratedAt: liveMeta.generatedAt, upToDate, topics, newItems, otherChanged,
    sources: { added: s.added.length, removed: s.removed.length, changed: s.changed.length },
  };
}
