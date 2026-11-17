// מדידת פעולות מסד נתונים (קריאות, כתיבות, מחיקות) לתרחישים, בהיקף המתוכנן: כ-200 מורים וכ-4,000 תלמידים.
// המדידה היא ברמת שכבת האחסון של האפליקציה (מסמך שמוחזר = קריאה אחת; שאילתה ריקה = קריאה אחת; כל פעולת כתיבה = כתיבה).
// היא אינה כוללת קריאות שכללי ההרשאות עצמם מבצעים (get/exists) ואינה מדידה מול Firebase אמיתי: ראו docs/QUOTA-he.md.
import { describe, expect, it } from 'vitest';
import { Api } from '../src/services/api';
import type { AuthService, AuthUser } from '../src/services/auth';
import { DEMO_ACCOUNTS, DEMO_SCHOOL_ID, seedStore } from '../src/services/demoSeed';
import { LocalStore } from '../src/services/localStore';
import type { BatchOp, Filter, Store, Tx } from '../src/services/store';
import { writeFileSync } from 'node:fs';

class Counting implements Store {
  readonly kind = 'local' as const;
  reads = 0; writes = 0; deletes = 0;
  constructor(private inner: LocalStore) {}
  reset() { this.reads = 0; this.writes = 0; this.deletes = 0; }
  snap() { return { reads: this.reads, writes: this.writes, deletes: this.deletes }; }
  async get<T>(p: string) { this.reads++; return this.inner.get<T>(p); }
  async count(c: string, w?: Filter[]) { const n = (await this.inner.list(c, w)).length; this.reads += Math.max(1, Math.ceil(n / 1000)); return n; }
  async list<T>(c: string, w?: Filter[]) { const r = await this.inner.list<T>(c, w); this.reads += Math.max(1, r.length); return r; }
  async set(p: string, d: object) { this.writes++; return this.inner.set(p, d); }
  async update(p: string, d: object) { this.writes++; return this.inner.update(p, d); }
  async delete(p: string) { this.deletes++; return this.inner.delete(p); }
  async batch(ops: BatchOp[]) { for (const o of ops) (o.op === 'delete' ? this.deletes++ : this.writes++); return this.inner.batch(ops); }
  async transact<T>(fn: (tx: Tx) => Promise<T>) { return this.inner.transact(async tx => fn({ get: async <U,>(p: string) => { this.reads++; return tx.get<U>(p); }, set: (p, d) => { this.writes++; tx.set(p, d); }, delete: p => { this.deletes++; tx.delete(p); } })); }
}

class TestAuth implements AuthService {
  readonly kind = 'demo' as const;
  u: AuthUser | null = null;
  current() { return this.u; }
  subscribe(cb: (u: AuthUser | null) => void) { cb(this.u); return () => {}; }
  as(uid: string | null) { const a = DEMO_ACCOUNTS.find(x => x.uid === uid); this.u = a ? { uid: a.uid, email: a.email, emailVerified: true, displayName: a.displayName } : uid ? { uid, email: `${uid}@x.test`, emailVerified: true, displayName: uid } : null; }
  async signUp(): Promise<any> {} async signIn() {} async signOut() {} async resetPassword() {}
  async resendVerification() { return { sent: false }; } async refresh() {}
}

const NOW = new Date(2027, 10, 15).getTime();
const YEAR = '2027-28';

/** מאגר בהיקף המתוכנן: 200 מורים, 1,400 קבוצות (כ-4,000 תלמידים), 400 בקשות, 300 מקורות, 12 מוסדות */
async function bigStore() {
  const inner = new LocalStore(null);
  await seedStore(inner, NOW, true);
  const ops: BatchOp[] = [];
  for (let s = 1; s <= 12; s++) ops.push({ op: 'set', path: `schools/${900000 + s}`, data: { name: `מוסד ${s}`, city: 'עיר', active: true } });
  for (let t = 0; t < 200; t++) {
    const uid = `bt${t}`; const school = `${900001 + (t % 12)}`;
    ops.push({ op: 'set', path: `profiles/${uid}`, data: { uid, displayName: `מורה ${t}`, email: `${uid}@x.test`, emailVerified: true, createdAt: NOW } });
    ops.push({ op: 'set', path: `allowedTeachers/${uid}@x.test`, data: { id: `${uid}@x.test`, email: `${uid}@x.test`, name: `מורה ${t}`, schoolIds: [school], active: true, addedBy: 'seed', addedAt: NOW } });
    for (let g = 0; g < 7; g++) ops.push({ op: 'set', path: `groups/bg${t}_${g}`, data: { ownerUid: uid, schoolId: school, yearId: YEAR, topicId: 't-S054', studentCount: g % 3 === 0 ? 3 : 2, students: [{ label: 'כ1' }, { label: 'כ2' }], status: g % 4 === 0 ? 'done' : 'self_check', casesDeclared: 0, ruleVersionAtCheck: null, createdAt: NOW, updatedAt: NOW } });
    if (t < 100) for (let r = 0; r < 4; r++) ops.push({ op: 'set', path: `requests/${uid}_20271110_${r + 1}`, data: { kind: 'inquiry', createdBy: uid, createdAt: NOW, updatedAt: NOW, status: r === 0 ? 'open' : 'answered', description: 'שאלה כללית', rationale: '', dueAt: NOW + 7 * 86400000, repliedAt: r === 0 ? undefined : NOW, teacherSeenAt: r === 0 ? undefined : NOW } });
    if (t < 150) for (let k = 0; k < 2; k++) ops.push({ op: 'set', path: `sources/${uid}_20271110_${k + 1}`, data: { topicId: `t-S${String(1 + ((t + k) % 100)).padStart(3, '0')}`, title: `מקור ${t}-${k}`, kind: 'association', text: 'מקור מלאכותי', url: 'https://example.org', phone: '', region: '', population: '', createdBy: uid, createdAt: NOW, visible: true, reviewed: t < 140 } });
  }
  for (let i = 0; i < ops.length; i += 400) await inner.batch(ops.slice(i, i + 400).map(o => (o.op === 'set' ? { ...o, data: JSON.parse(JSON.stringify((o as any).data)) } : o)));
  const store = new Counting(inner);
  const auth = new TestAuth();
  const api = new Api(store, auth, 'service', () => NOW);
  auth.as('demo-admin');
  await api.publishCatalog();
  store.reset();
  return { store, auth, api, inner };
}

describe('מדידת פעולות מסד בהיקף המתוכנן (נתוני ניסוי)', () => {
  it('תרחישים עיקריים, וגבולות תקציב שאינם נחצים', async () => {
    const { store, auth, api } = await bigStore();
    const rows: [string, ReturnType<Counting['snap']>][] = [];
    const m = async (name: string, who: string | null, fn: () => Promise<unknown>) => { auth.as(who); api.clearCtxCache(); store.reset(); await fn(); rows.push([name, store.snap()]); };

    await m('אורח: טעינת דף הבית (קטלוג וחיפוש)', null, () => api.loadCatalog());
    await m('אורח: פתיחת כרטיס נושא ולשונית איתור מטופלים', null, () => api.listSources('t-S050'));
    await m('מורה: כניסה (תפקיד, פרופיל, חיווי "חדש" בבקשות, שיוך למוסד)', 'bt5', async () => { await api.ctx(); await api.ensureProfile(); await api.myUnseenReplies(); await api.mySchools(); });
    await m('מורה: טעינת "הקבוצות שלי"', 'bt5', () => api.listMyGroups());
    await m('מורה: יצירת קבוצה חדשה', 'bt5', () => api.createGroup({ schoolId: '900006', yearId: YEAR, studentCount: 2, students: ['א', 'ב'], topicId: 't-S054' }));
    await m('מורה: הוספת מקור איתור', 'bt5', () => api.addSource({ topicId: 't-S054', title: 'עמותה מלאכותית', kind: 'association', text: 'מלאכותי', url: 'https://example.org', phone: '', region: '', population: '', confirmNoPatientData: true }));
    await m('מורה: הגשת בקשה', 'bt5', () => api.createRequest({ kind: 'inquiry', description: 'שאלה כללית' }));
    await m('מורה: צפייה ב"הבקשות שלי" וסימון כנראו', 'bt5', async () => { const rs = await api.listMyRequests(); await api.markMyRepliesSeen(rs); });
    await m('מנהל: כניסה (חיווי "דורש טיפול")', 'demo-admin', () => api.adminBadges());
    await m('מנהל: מסך תמונת מצב', 'demo-admin', async () => { await api.adminBadges(); await api.adminListRequests(['open']); await api.adminListRequests(['in_progress']); await api.adminListSources(true); await api.adminListSourceReports(true); await api.getBackupMeta(); });
    await m('מנהל: מענה לבקשה', 'demo-admin', async () => { const [r] = await api.adminListRequests(['open']); await api.adminReply(r.id, { decisionKind: 'general_approval', text: 'אושר', status: 'answered' }); });
    await m('מנהל: סימון כל המקורות החדשים כנבדקו', 'demo-admin', async () => { const s = await api.adminListSources(true); await api.adminMarkSourcesReviewed(s.map(x => x.id)); });
    await m('מנהל: פרסום מחדש של הקטלוג', 'demo-admin', () => api.publishCatalog());
    await m('מנהל: גיבוי תוכן ידני', 'demo-admin', () => api.exportBackup(false));
    await m('מנהל: גיבוי פרטי ידני (כולל קבוצות ובקשות)', 'demo-admin', () => api.exportBackup(true));
    await m('מנהל: תצוגה מקדימה של סגירת מחזור', 'demo-admin', () => api.cycleClosePreview(YEAR));
    await m('מנהל: סגירת מחזור בפועל (פעם בשנה)', 'demo-admin', () => api.closeCycle(YEAR, { force: true }));

    const fmt = (n: number) => String(n).padStart(6);
    const table = ['| תרחיש | קריאות | כתיבות | מחיקות |', '|---|---|---|---|', ...rows.map(([n, s]) => `| ${n} | ${s.reads} | ${s.writes} | ${s.deletes} |`)].join('\n');
    // eslint-disable-next-line no-console
    console.log('\n' + rows.map(([n, s]) => `${fmt(s.reads)} r ${fmt(s.writes)} w ${fmt(s.deletes)} d  ${n}`).join('\n'));
    writeFileSync('docs/quota-measured.md', `<!-- נוצר אוטומטית מ-tests/quota.test.ts. נתוני ניסוי: 200 מורים, 1,400 קבוצות, 400 בקשות, 300 מקורות. מדידה ברמת האפליקציה בלבד. -->\n${table}\n`);

    const get = (name: string) => rows.find(([n]) => n.startsWith(name))![1];
    // תקציב: אורח ומורה בשימוש רגיל נשארים קטנים; אין קריאה לכל המקורות בכל ביקור
    expect(get('אורח: טעינת דף הבית').reads).toBeLessThanOrEqual(8);
    expect(get('אורח: פתיחת כרטיס נושא').reads).toBeLessThanOrEqual(5);
    expect(get('מורה: כניסה').reads).toBeLessThanOrEqual(20);
    expect(get('מורה: הוספת מקור').reads).toBeLessThanOrEqual(8);
    expect(get('מנהל: כניסה').reads).toBeLessThanOrEqual(10); // ספירות בלבד, לא תלוי בגודל הצבר
  });
});
