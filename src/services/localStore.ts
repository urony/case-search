import { BatchOp, Filter, ServiceUnavailableError, splitPath, Store, Tx } from './store';

type Db = Record<string, Record<string, any>>;

const clone = <T,>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

function matches(doc: any, where: Filter[] = []): boolean {
  return where.every(([f, op, v]) => {
    const x = doc?.[f];
    if (op === '==') return x === v;
    if (op === '!=') return x !== v;
    if (op === 'in') return Array.isArray(v) && v.includes(x);
    return false;
  });
}

/**
 * מימוש מקומי בזיכרון, עם שמירה אופציונלית ל-localStorage.
 * מיועד להדגמה ולבדיקות. שמירה בדפדפן אינה "שמירה משותפת" ואין להציגה ככזו (סעיף 20.3).
 */
export class LocalStore implements Store {
  readonly kind: 'local' | 'readonly';
  private db: Db = {};
  constructor(private persistKey: string | null = null, readonly = false) {
    this.kind = readonly ? 'readonly' : 'local';
    if (persistKey && typeof localStorage !== 'undefined') {
      try { const raw = localStorage.getItem(persistKey); if (raw) this.db = JSON.parse(raw); } catch { /* ignore */ }
    }
  }
  private guard() { if (this.kind === 'readonly') throw new ServiceUnavailableError('מצב קריאה בלבד: שירות הנתונים אינו מוגדר, ולכן לא ניתן לשמור.'); }
  private persist() {
    if (this.persistKey && typeof localStorage !== 'undefined') {
      try { localStorage.setItem(this.persistKey, JSON.stringify(this.db)); } catch { /* quota */ }
    }
  }
  isEmpty() { return Object.keys(this.db).length === 0; }
  reset() { this.db = {}; this.persist(); }

  async get<T>(path: string): Promise<T | null> {
    const [c, id] = splitPath(path);
    const d = this.db[c]?.[id];
    return d === undefined ? null : ({ ...clone(d), id } as T);
  }
  async list<T>(collection: string, where?: Filter[]): Promise<T[]> {
    return Object.entries(this.db[collection] ?? {}).filter(([, d]) => matches(d, where)).map(([id, d]) => ({ ...clone(d), id }) as T);
  }
  private put(path: string, data: object) {
    const [c, id] = splitPath(path);
    const { id: _ignored, ...rest } = data as any;
    (this.db[c] ??= {})[id] = clone(rest);
  }
  async set(path: string, data: object) { this.guard(); this.put(path, data); this.persist(); }
  async update(path: string, patch: object) {
    this.guard();
    const [c, id] = splitPath(path);
    if (!this.db[c]?.[id]) throw new Error(`document not found: ${path}`);
    this.put(path, { ...this.db[c][id], ...(patch as object) });
    this.persist();
  }
  async delete(path: string) { this.guard(); const [c, id] = splitPath(path); delete this.db[c]?.[id]; this.persist(); }
  async batch(ops: BatchOp[]) {
    this.guard();
    // אטומי: מחילים על עותק ורק אז מחליפים
    const snapshot = clone(this.db);
    try {
      for (const o of ops) {
        if (o.op === 'set') this.put(o.path, o.data);
        else if (o.op === 'update') {
          const [c, id] = splitPath(o.path);
          if (!this.db[c]?.[id]) throw new Error(`document not found: ${o.path}`);
          this.put(o.path, { ...this.db[c][id], ...o.data });
        } else { const [c, id] = splitPath(o.path); delete this.db[c]?.[id]; }
      }
    } catch (e) { this.db = snapshot; throw e; }
    this.persist();
  }
  async transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.guard();
    const pending: BatchOp[] = [];
    const tx: Tx = {
      get: p => this.get(p),
      set: (path, data) => { pending.push({ op: 'set', path, data }); },
      delete: path => { pending.push({ op: 'delete', path }); },
    };
    const r = await fn(tx);
    await this.batch(pending);
    return r;
  }
  /** לבדיקות ולגיבוי: יצוא כל הקבוצות */
  dump(): Db { return clone(this.db); }
}
