import {
  collection, deleteDoc, doc, Firestore, getCountFromServer, getDoc, getDocs, query, runTransaction, setDoc, updateDoc, where, writeBatch,
  QueryConstraint,
} from 'firebase/firestore';
import { BatchOp, Filter, splitPath, Store, Tx } from './store';

/** מימוש Firestore. בכוונה בלי מטמון מתמשך (IndexedDB), כדי שנתוני קבוצות לא יישמרו בדפדפן. */
export class FirestoreStore implements Store {
  readonly kind = 'firestore' as const;
  constructor(private db: Firestore) {}
  private ref(path: string) { const [c, id] = splitPath(path); return doc(this.db, c, id); }

  async get<T>(path: string): Promise<T | null> {
    const s = await getDoc(this.ref(path));
    return s.exists() ? ({ ...s.data(), id: s.id } as T) : null;
  }
  async list<T>(coll: string, filters: Filter[] = []): Promise<T[]> {
    const cs: QueryConstraint[] = filters.map(([f, op, v]) => where(f, op === 'in' ? 'in' : op, v as any));
    const s = await getDocs(cs.length ? query(collection(this.db, coll), ...cs) : collection(this.db, coll));
    return s.docs.map(d => ({ ...d.data(), id: d.id }) as T);
  }
  async count(coll: string, filters: Filter[] = []): Promise<number> {
    const cs: QueryConstraint[] = filters.map(([f, op, v]) => where(f, op === 'in' ? 'in' : op, v as any));
    const s = await getCountFromServer(cs.length ? query(collection(this.db, coll), ...cs) : collection(this.db, coll));
    return s.data().count;
  }
  async set(path: string, data: object) { const { id: _i, ...rest } = data as any; await setDoc(this.ref(path), rest); }
  async update(path: string, patch: object) { const { id: _i, ...rest } = patch as any; await updateDoc(this.ref(path), rest); }
  async delete(path: string) { await deleteDoc(this.ref(path)); }
  async batch(ops: BatchOp[]) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(this.db);
      for (const o of ops.slice(i, i + 400)) {
        if (o.op === 'set') { const { id: _i, ...rest } = o.data as any; b.set(this.ref(o.path), rest); }
        else if (o.op === 'update') { const { id: _i, ...rest } = o.data as any; b.update(this.ref(o.path), rest); }
        else b.delete(this.ref(o.path));
      }
      await b.commit();
    }
  }
  async transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return runTransaction(this.db, async t => {
      const tx: Tx = {
        get: async <U,>(path: string) => { const s = await t.get(this.ref(path)); return s.exists() ? ({ ...s.data(), id: s.id } as U) : null; },
        set: (path, data) => { const { id: _i, ...rest } = data as any; t.set(this.ref(path), rest); },
        delete: path => { t.delete(this.ref(path)); },
      };
      return fn(tx);
    });
  }
}
