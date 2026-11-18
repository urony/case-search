import { beforeEach, describe, expect, it } from 'vitest';
import { Api, CATALOG_FRESH_MS, SnapshotCache } from '../src/services/api';
import { AuthService, AuthUser } from '../src/services/auth';
import { DEMO_ACCOUNTS, seedStore } from '../src/services/demoSeed';
import { LocalStore } from '../src/services/localStore';
import type { BatchOp, Filter, Store, Tx } from '../src/services/store';
import { PermissionError } from '../src/services/store';
import type { Catalog, CatalogMeta } from '../src/domain/types';

class TestAuth implements AuthService {
  readonly kind = 'demo' as const;
  u: AuthUser | null = null;
  current() { return this.u; }
  subscribe(cb: (u: AuthUser | null) => void) { cb(this.u); return () => {}; }
  as(uid: string | null, verified = true) {
    const a = DEMO_ACCOUNTS.find(x => x.uid === uid);
    this.u = a ? { uid: a.uid, email: a.email, emailVerified: verified, displayName: a.displayName } : null;
  }
  async signUp(): Promise<any> {} async signIn() {} async signOut() {} async resetPassword() {}
  async resendVerification() { return { sent: false }; } async refresh() {}
}

/** עוטף מאגר וסופר קריאות (מסמך אחד = קריאה אחת), ויכול לדמות כשל */
class CountingStore implements Store {
  reads = 0; failReads = false; dropMetaWrite = false;
  constructor(private inner: Store) {}
  get kind() { return this.inner.kind; }
  async get<T>(path: string) { if (this.failReads) throw new Error('offline'); this.reads++; return this.inner.get<T>(path); }
  async list<T>(c: string, w?: Filter[]) { if (this.failReads) throw new Error('offline'); const r = await this.inner.list<T>(c, w); this.reads += r.length; return r; }
  async count(c: string, w?: Filter[]) { return this.inner.count(c, w); }
  set(p: string, d: object) { return this.inner.set(p, d); }
  update(p: string, d: object) { return this.inner.update(p, d); }
  delete(p: string) { return this.inner.delete(p); }
  async batch(ops: BatchOp[]) { return this.inner.batch(this.dropMetaWrite ? ops.filter(o => o.path !== 'public/catalogMeta') : ops); }
  transact<T>(fn: (tx: Tx) => Promise<T>) { return this.inner.transact(fn); }
}

class MemCache implements SnapshotCache {
  v: { checkedAt: number; catalog: Catalog } | null = null;
  read() { return this.v ? JSON.parse(JSON.stringify(this.v)) : null; }
  write(v: { checkedAt: number; catalog: Catalog }) { this.v = JSON.parse(JSON.stringify(v)); }
  clear() { this.v = null; }
}

let NOW = new Date(2027, 10, 15).getTime();
let inner: LocalStore, store: CountingStore, auth: TestAuth, api: Api, cache: MemCache;
const YEAR = '2027-28';

beforeEach(async () => {
  NOW = new Date(2027, 10, 15).getTime();
  inner = new LocalStore(null);
  await seedStore(inner, NOW, true);
  store = new CountingStore(inner);
  auth = new TestAuth();
  cache = new MemCache();
  api = new Api(store, auth, 'service', () => NOW);
  api.snapshotCache = cache;
});

const item = { yearId: YEAR, topicId: 't-S063', title: 'אסתמה: הבהרה', text: 'נוספה הבהרה לגבי אסתמה (בדיקה).', visible: true };
const src = { topicId: 't-S063', title: 'עמותה מלאכותית לבדיקה', kind: 'association' as const, text: 'מקור מלאכותי', url: 'https://example.org', phone: '', region: 'ארצי', population: '', confirmNoPatientData: true };

describe('הרשאות ניהול (נאכפות בשירות, לא רק בממשק)', () => {
  for (const who of [null, 'demo-teacher', 'demo-coord', 'demo-pending'] as const) {
    it(`${who ?? 'אורח'} אינו יכול לנהל תוכן ציבורי או לפרסם`, async () => {
      auth.as(who);
      await expect(api.adminSaveNewItem(item)).rejects.toThrow(PermissionError);
      await expect(api.adminListNewItems()).rejects.toThrow(PermissionError);
      await expect(api.adminDeleteNewItem('x')).rejects.toThrow(PermissionError);
      await expect(api.adminAddSource(src)).rejects.toThrow(PermissionError);
      await expect(api.publishCatalog()).rejects.toThrow(PermissionError);
      await expect(api.adminPublishDiff()).rejects.toThrow(PermissionError);
    });
  }
  it('מנהל שהמייל שלו לא אומת אינו מנהל', async () => {
    auth.as('demo-admin', false);
    await expect(api.publishCatalog()).rejects.toThrow(/לאמת/);
  });
});

describe('מה נוסף השנה', () => {
  it('ללא פריטים: רשימה ריקה (המסך מציג "עדיין לא נוספו")', async () => {
    expect((await api.loadCatalog()).newItems).toEqual([]);
  });
  it('פריט אינו נראה לציבור עד פרסום, ואז נראה בלי מזהה מנהל', async () => {
    auth.as('demo-admin');
    const it1 = await api.adminSaveNewItem(item);
    auth.as(null); cache.clear();
    expect((await api.loadCatalog()).newItems).toEqual([]);
    auth.as('demo-admin'); await api.publishCatalog();
    auth.as(null); cache.clear();
    const pub = (await api.loadCatalog()).newItems!;
    expect(pub.map(x => x.id)).toEqual([it1.id]);
    expect(JSON.stringify(pub)).not.toContain('demo-admin');
  });
  it('פריט מוסתר או שנמחק יוצא מהתצוגה בפרסום הבא', async () => {
    auth.as('demo-admin');
    const a = await api.adminSaveNewItem(item);
    await api.publishCatalog();
    await api.adminSaveNewItem({ ...item, id: a.id, visible: false });
    await api.publishCatalog();
    expect((await api.loadCatalog()).newItems).toEqual([]);
    await api.adminSaveNewItem({ ...item, id: a.id, visible: true });
    await api.publishCatalog(); cache.clear();
    expect((await api.loadCatalog()).newItems!.length).toBe(1);
    await api.adminDeleteNewItem(a.id); await api.publishCatalog(); cache.clear();
    expect((await api.loadCatalog()).newItems).toEqual([]);
  });
  it('דוחה כותרת קצרה, טקסט ריק ופרטים אישיים', async () => {
    auth.as('demo-admin');
    await expect(api.adminSaveNewItem({ ...item, title: 'א' })).rejects.toThrow(/כותרת/);
    await expect(api.adminSaveNewItem({ ...item, text: '' })).rejects.toThrow(/תיאור/);
    await expect(api.adminSaveNewItem({ ...item, text: 'צרו קשר: someone@example.com' })).rejects.toThrow(/מייל|זיהוי/);
  });
  it('שינוי בפריט שומר על תאריך הפרסום המקורי', async () => {
    auth.as('demo-admin');
    const a = await api.adminSaveNewItem(item);
    NOW += 86_400_000;
    const b = await api.adminSaveNewItem({ ...item, id: a.id, text: 'נוסח מעודכן של התיאור.' });
    expect(b.publishedAt).toBe(a.publishedAt);
  });
});

describe('מקורות איתור בידי מנהל', () => {
  it('ללא מכסה יומית, מסומן נבדק, ומופיע בעותק הציבורי בלי מזהי משתמש', async () => {
    auth.as('demo-admin');
    for (let i = 0; i < 7; i++) await api.adminAddSource({ ...src, title: `עמותה מלאכותית ${i}` });
    await api.publishCatalog();
    auth.as(null); cache.clear();
    const c = await api.loadCatalog();
    expect(c.sources!['t-S063'].length).toBe(7);
    expect(c.sourceCounts!['t-S063']).toBe(7);
    const json = JSON.stringify(c.sources);
    expect(json).not.toContain('createdBy');
    expect(json).not.toContain('demo-admin');
    expect(json).not.toContain('reviewed');
  });
  it('מקור שהוסר אינו מופיע בפרסום הבא', async () => {
    auth.as('demo-admin');
    const s = await api.adminAddSource(src);
    await api.publishCatalog();
    await api.adminRemoveSource(s.id);
    await api.publishCatalog(); cache.clear();
    expect((await api.loadCatalog()).sources!['t-S063'] ?? []).toEqual([]);
  });
  it('מקור מצביע ל-javascript נדחה', async () => {
    auth.as('demo-admin');
    await expect(api.adminAddSource({ ...src, url: 'javascript:alert(1)' })).rejects.toThrow();
  });
});

describe('העותק הציבורי', () => {
  it('כולל הגדרות ציבוריות בלי כתובת האחראי', async () => {
    auth.as('demo-admin');
    await api.publishCatalog();
    const meta = await inner.get<CatalogMeta>('public/catalogMeta');
    expect(meta!.general!.rules.length).toBeGreaterThan(0);
    expect(meta!.settings!.responsibleEmail).toBe('');
    expect(JSON.stringify(meta)).not.toContain('responsible@demo.test');
  });
  it('טיוטה אינה נכללת בעותק הציבורי', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S063'))!;
    await api.saveTopic({ ...t, publish: 'draft' }, t.version);
    await api.publishCatalog(); cache.clear();
    expect((await api.loadCatalog()).topics.some(x => x.id === 't-S063')).toBe(false);
  });
  it('פרסום שלא נקרא בחזרה נכשל בקול (לא מדווח כהצלחה)', async () => {
    auth.as('demo-admin');
    store.dropMetaWrite = true; NOW += 1000; // מועד שונה ממועד הזריעה, אחרת העותק הישן נראה כאילו נכתב
    await expect(api.publishCatalog()).rejects.toThrow(/לא אומת/);
  });
  it('דוח שינויים: מעודכן אחרי פרסום, ומזהה שינוי אחרי עריכה', async () => {
    auth.as('demo-admin');
    expect((await api.adminPublishDiff()).upToDate).toBe(true); // הזריעה פרסמה
    await api.adminSaveNewItem(item);
    const t = (await api.adminGetTopic('t-S063'))!;
    await api.saveTopic({ ...t, he: 'אסתמה (שם מעודכן)' }, t.version);
    const d = await api.adminPublishDiff();
    expect(d.upToDate).toBe(false);
    expect(d.newItems.added).toEqual([item.title]);
    expect(d.topics.changed).toEqual(['אסתמה (שם מעודכן)']);
    await api.publishCatalog();
    expect((await api.adminPublishDiff()).upToDate).toBe(true);
  });
  it('שמירת נושא אינה מפרסמת אותו לציבור (הפרסום הוא פעולה נפרדת)', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S063'))!;
    await api.saveTopic({ ...t, he: 'שם חדש בטיוטה' }, t.version);
    auth.as(null); cache.clear();
    expect((await api.loadCatalog()).topics.find(x => x.id === 't-S063')!.he).not.toBe('שם חדש בטיוטה');
  });
});

describe('חיסכון בקריאות ומצבי כשל', () => {
  it('ביקור ראשון: מסמך ראשי, נושאים ומקורות; ביקור חוזר בתוך 5 דקות: אפס קריאות', async () => {
    await api.loadCatalog();
    const first = store.reads;
    expect(first).toBeLessThanOrEqual(4);
    store.reads = 0;
    await api.loadCatalog();
    expect(store.reads).toBe(0);
  });
  it('אחרי 5 דקות והעותק לא השתנה: קריאה אחת בלבד', async () => {
    await api.loadCatalog();
    store.reads = 0; NOW += CATALOG_FRESH_MS + 1000;
    const c = await api.loadCatalog();
    expect(store.reads).toBe(1);
    expect(c.stale).toBeFalsy();
  });
  it('מבקר אחר: רואה פרסום חדש רק אחרי חלון הרענון, ואז מוריד את החדש', async () => {
    const guestCache = new MemCache();
    const guest = new Api(store, new TestAuth(), 'service', () => NOW);
    guest.snapshotCache = guestCache;
    await guest.loadCatalog();
    auth.as('demo-admin'); NOW += 1000;
    await api.adminSaveNewItem(item); await api.publishCatalog();
    expect((await guest.loadCatalog()).newItems).toEqual([]); // בתוך החלון: עדיין העותק הקודם (מתועד)
    NOW += CATALOG_FRESH_MS + 1;
    const c = await guest.loadCatalog();
    expect(c.newItems!.length).toBe(1);
    expect(c.generatedAt).toBe(NOW - CATALOG_FRESH_MS - 1);
  });
  it('כשל בקריאה עם עותק שמור: מוצג כשמור (stale) ולא כעדכני', async () => {
    await api.loadCatalog();
    NOW += CATALOG_FRESH_MS + 1000; store.failReads = true;
    const c = await api.loadCatalog();
    expect(c.stale).toBe(true);
    expect(c.topics.length).toBeGreaterThan(100);
  });
  it('כשל ללא עותק שמור בשירות: עותק מובנה מסומן bundled', async () => {
    store.failReads = true;
    const c = await api.loadCatalog();
    expect(c.origin).toBe('bundled');
  });
  it('עותק ציבורי ישן (בלי הגדרות במסמך הראשי) עדיין נטען', async () => {
    const meta = (await inner.get<CatalogMeta>('public/catalogMeta'))!;
    const { general, vocab, settings, years, newItems, sourceChunks, ...old } = meta as any;
    void general; void vocab; void settings; void years; void newItems; void sourceChunks;
    await inner.set('public/catalogMeta', old);
    const c = await api.loadCatalog();
    expect(c.topics.length).toBe(115);
    expect(c.generalRules.rules.length).toBeGreaterThan(0);
    expect(c.systems.length).toBeGreaterThan(5);
  });
});

describe('הצעות מהציבור (בלי כניסה, מתפרסמות רק באישור מנהל)', () => {
  const good = { topicId: 't-S063', title: 'עמותת אסתמה מלאכותית', text: 'עמותה לדוגמה שעשויה לסייע באיתור, מלאכותי לבדיקה.', url: 'https://example.org', contact: 'דוא״ל לבדיקה' };
  it('אורח שולח הצעה, ואינה מתפרסמת ואינה נקראת בידו', async () => {
    auth.as(null);
    await api.submitSuggestion(good);
    expect((await inner.list('publicSuggestions')).length).toBe(1);
    await expect(api.adminListPublicSuggestions()).rejects.toThrow(PermissionError);
    await expect(api.adminResolvePublicSuggestion('x', 'approved')).rejects.toThrow(PermissionError);
    expect((await api.loadCatalog()).sources?.['t-S063'] ?? []).toEqual([]);
  });
  it('דוחה קלט לא תקין: כותרת קצרה, טקסט קצר, קישור מסוכן, פרטים אישיים', async () => {
    auth.as(null);
    await expect(api.submitSuggestion({ ...good, title: 'א' })).rejects.toThrow(/כותרת/);
    await expect(api.submitSuggestion({ ...good, text: 'קצר' })).rejects.toThrow(/תיאור/);
    await expect(api.submitSuggestion({ ...good, url: 'javascript:alert(1)' })).rejects.toThrow(/כתובת/);
    await expect(api.submitSuggestion({ ...good, text: 'צרו קשר someone@example.com בבקשה' })).rejects.toThrow(/זיהוי|מייל/);
    await expect(api.submitSuggestion({ ...good, topicId: '' })).rejects.toThrow(/נושא/);
    expect((await inner.list('publicSuggestions')).length).toBe(0);
  });
  it('מנהל רואה, מאשר: נוצר מקור שמתפרסם רק בפרסום הבא', async () => {
    auth.as(null); await api.submitSuggestion(good);
    auth.as('demo-admin');
    const [s] = await api.adminListPublicSuggestions('open');
    expect(await api.adminCountOpenPublicSuggestions()).toBe(1);
    await api.adminResolvePublicSuggestion(s.id, 'approved');
    expect(await api.adminCountOpenPublicSuggestions()).toBe(0);
    auth.as(null); cache.clear();
    expect((await api.loadCatalog()).sources?.['t-S063'] ?? []).toEqual([]);
    auth.as('demo-admin'); NOW += 1000; await api.publishCatalog();
    auth.as(null); cache.clear();
    const pub = (await api.loadCatalog()).sources!['t-S063'];
    expect(pub.length).toBe(1);
    expect(JSON.stringify(pub)).not.toContain('דוא״ל לבדיקה'); // פרטי הקשר אינם מתפרסמים
  });
  it('דחייה אינה יוצרת מקור, ואי אפשר לטפל פעמיים', async () => {
    auth.as(null); await api.submitSuggestion(good);
    auth.as('demo-admin');
    const [s] = await api.adminListPublicSuggestions('open');
    await api.adminResolvePublicSuggestion(s.id, 'rejected');
    await expect(api.adminResolvePublicSuggestion(s.id, 'approved')).rejects.toThrow(/כבר טופלה/);
    expect((await inner.list('sources')).some((x: any) => x.title === good.title)).toBe(false);
  });
});

describe('מנהל לפי רשימת מייל (admins)', () => {
  const pend = DEMO_ACCOUNTS.find(a => a.uid === 'demo-pending')!;
  it('מייל ברשימה ומאומת: מנהל; לא מאומת או לא ברשימה: לא', async () => {
    auth.as('demo-pending');
    await expect(api.adminListNewItems()).rejects.toThrow(PermissionError);
    await inner.set(`admins/${pend.email.toLowerCase()}`, { note: 'x' });
    api.clearCtxCache();
    await expect(api.adminListNewItems()).resolves.toBeDefined();
    auth.as('demo-pending', false); api.clearCtxCache();
    await expect(api.adminListNewItems()).rejects.toThrow(PermissionError);
  });
});
