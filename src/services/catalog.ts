import type { Topic } from '../domain/types';
import type { BatchOp, Store } from './store';

export const CATALOG_CHUNK = 120;

/**
 * בונה את פעולות הכתיבה לקטלוג הציבורי: מסמכים מקובצים, כך שביקור של אורח עולה כמה קריאות בודדות
 * ולא קריאה לכל נושא. רק נושאים שפורסמו נכללים; טיפולי טיוטה אינם גלויים לציבור.
 */
export async function buildCatalogOps(store: Store, now: number): Promise<{ ops: BatchOp[]; topics: number; chunks: number }> {
  const topics = (await store.list<Topic>('topics', [['publish', '==', 'published']])).sort((a, b) => a.he.localeCompare(b.he, 'he'));
  const chunks = Math.max(1, Math.ceil(topics.length / CATALOG_CHUNK));
  const old = await store.get<{ chunks: number }>('public/catalogMeta');
  const ops: BatchOp[] = [];
  for (let i = 0; i < chunks; i++) ops.push({ op: 'set', path: `public/catalog_${i}`, data: { topics: topics.slice(i * CATALOG_CHUNK, (i + 1) * CATALOG_CHUNK) } });
  for (let i = chunks; i < (old?.chunks ?? 0); i++) ops.push({ op: 'delete', path: `public/catalog_${i}` });
  ops.push({ op: 'set', path: 'public/catalogMeta', data: { chunks, generatedAt: now } });
  return { ops, topics: topics.length, chunks };
}
