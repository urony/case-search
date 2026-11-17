import type { Catalog } from '../domain/types';
import type { SnapshotCache } from './api';

const KEY = 'mat-public-snapshot-v1';

/**
 * עותק מקומי של המידע הציבורי בלבד (נושאים, תנאים, מקורות איתור, מה נוסף השנה), לחיסכון בקריאות.
 * אין בו מידע אישי או מידע של משתמש. כל גישה עטופה ב-try/catch: אם האחסון חסום, האתר פשוט פונה לשירות.
 */
export const localStorageSnapshotCache: SnapshotCache = {
  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { checkedAt: number; catalog: Catalog };
      return v && typeof v.checkedAt === 'number' && v.catalog && Array.isArray(v.catalog.topics) ? v : null;
    } catch { return null; }
  },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* אחסון חסום או מלא */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};
