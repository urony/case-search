import { beforeEach, describe, expect, it } from 'vitest';
import { Api } from '../src/services/api';
import type { AuthService, AuthUser } from '../src/services/auth';
import { DEMO_ACCOUNTS, DEMO_SCHOOL_ID, seedStore } from '../src/services/demoSeed';
import { LocalStore } from '../src/services/localStore';
import { PermissionError } from '../src/services/store';

class TestAuth implements AuthService {
  readonly kind = 'demo' as const;
  u: AuthUser | null = null;
  current() { return this.u; }
  subscribe(cb: (u: AuthUser | null) => void) { cb(this.u); return () => {}; }
  as(uid: string | null) { const a = DEMO_ACCOUNTS.find(x => x.uid === uid); this.u = a ? { uid: a.uid, email: a.email, emailVerified: true, displayName: a.displayName } : null; }
  async signUp(): Promise<any> {} async signIn() {} async signOut() {} async resetPassword() {}
  async resendVerification() { return { sent: false }; } async refresh() {}
}

const NOW = new Date(2027, 10, 15).getTime();
let store: LocalStore, auth: TestAuth, api: Api;
const YEAR = '2027-28';
beforeEach(async () => {
  store = new LocalStore(null);
  await seedStore(store, NOW, true);
  auth = new TestAuth();
  api = new Api(store, auth, 'demo', () => NOW);
});
const getDoc = (path: string) => store.get<any>(path);

describe('גיבוי ידני: תוכן ופרטיות', () => {
  it('גיבוי תוכן: אין תלמידים, בקשות, דיווחים, פרופילים, תפקידים או כתובות מייל', async () => {
    auth.as('demo-teacher');
    await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['כינוי־סודי'], topicId: 't-S054' });
    await api.createRequest({ kind: 'inquiry', description: 'שאלה כללית אך מזוהה: טקסט־בקשה' });
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    const text = JSON.stringify(b);
    for (const bad of ['כינוי־סודי', 'טקסט־בקשה', '@demo.test']) expect(text).not.toContain(bad);
    for (const coll of ['groups', 'requests', 'sourceReports', 'profiles', 'roles', 'allowedTeachers']) expect(b.data[coll]).toBeUndefined();
    expect(b.format).toBe('mat-backup-2');
    expect(b.counts!.topics).toBeGreaterThan(100);
    expect(b.includesPrivate).toBe(false);
  });
  it('גיבוי פרטי כולל את הפרטים, וגיבוי רושם מועד אחרון', async () => {
    auth.as('demo-teacher');
    await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['כינוי־סודי'], topicId: 't-S054' });
    auth.as('demo-admin');
    expect(await api.getBackupMeta()).toBeNull();
    const b = await api.exportBackup(true);
    expect(JSON.stringify(b)).toContain('כינוי־סודי');
    expect((await api.getBackupMeta())!.lastBackupPrivate).toBe(true);
    // מטא־נתוני הגיבוי אינם חלק מהגיבוי עצמו
    expect(b.data.config.some((d: any) => d.id === 'backupMeta')).toBe(false);
  });
  it('רק מנהל יוצר גיבוי, מציג תצוגה מקדימה או משחזר', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    for (const who of ['demo-teacher', 'demo-coord', null]) {
      auth.as(who);
      await expect(api.exportBackup(false)).rejects.toThrow();
      await expect(api.previewRestore(b)).rejects.toThrow();
      await expect(api.restoreBackup(b)).rejects.toThrow();
    }
    auth.as('demo-teacher');
    await expect(api.restoreBackup(b)).rejects.toThrow(PermissionError);
  });
});

describe('שחזור: בלי דריסה לא מכוונת', () => {
  it('תצוגה מקדימה אינה כותבת דבר', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    await api.saveSettings({ ...(await api.getAdminSettings()), responseDueDays: 4 });
    const before = JSON.stringify(store.dump());
    const p = await api.previewRestore(b, 'overwrite');
    expect(p.writes).toBeGreaterThan(0);
    expect(JSON.stringify(store.dump())).toBe(before);
  });
  it('הוספת חסרים: מסמך שנמחק חוזר, מסמך ששונה אחרי הגיבוי נשאר, מסמך חדש אינו נמחק', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    const t = (await api.adminGetTopic('t-S020'))!;
    await api.saveTopic({ ...t, ageMax: 17 }, t.version);                   // שונה אחרי הגיבוי
    await store.delete('topics/t-S054');                                   // נמחק אחרי הגיבוי
    await store.set('policyQuestions/new-after', { title: 'חדש אחרי הגיבוי' }); // נוסף אחרי הגיבוי
    const res = await api.restoreBackup(b, { mode: 'add_missing' });
    expect(res.restored).toBeGreaterThan(0);
    expect((await getDoc('topics/t-S054'))).not.toBeNull();                 // חזר
    expect((await getDoc('topics/t-S020')).ageMax).toBe(17);                // נשאר
    expect((await getDoc('policyQuestions/new-after'))).not.toBeNull();     // לא נמחק
    // הרצה חוזרת אינה כותבת שוב: חוזר־בטוח
    expect((await api.restoreBackup(b, { mode: 'add_missing' })).restored).toBe(0);
  });
  it('החזרת מצב הגיבוי: דורסת ששונה, אך לא נושא עם גרסה חדשה יותר, לא גרסאות שמורות ולא את מה שנוסף', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    const t = (await api.adminGetTopic('t-S020'))!;
    await api.saveTopic({ ...t, ageMax: 17 }, t.version);                   // נושא: גרסה חדשה יותר במערכת
    await api.saveSettings({ ...(await api.getAdminSettings()), responseDueDays: 4 }); // הגדרה (בלי גרסה): תידרס
    await store.set('policyQuestions/new-after', { title: 'חדש אחרי הגיבוי' });
    const v2 = await getDoc('topicVersions/t-S020__v2');
    await api.restoreBackup(b, { mode: 'overwrite' });
    expect((await getDoc('topics/t-S020')).ageMax).toBe(17);                // נשאר: גרסתו במערכת חדשה
    expect(await getDoc('topicVersions/t-S020__v2')).toEqual(v2);           // גרסה שמורה לא נדרסה
    expect((await getDoc('config/settings')).responseDueDays).not.toBe(4);  // הוחזר למצב הגיבוי
    expect((await getDoc('policyQuestions/new-after'))).not.toBeNull();     // לא נמחק
  });
  it('אוסף לא מוכר בקובץ גיבוי אינו נכתב', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    (b.data as any).evil = [{ id: 'x', a: 1 }];
    await api.restoreBackup(b);
    expect(await getDoc('evil/x')).toBeNull();
  });
  it('היסטוריה של מחזור שנסגר אינה נדרסת בשחזור מגיבוי ישן, וקבוצות שלו אינן חוזרות', async () => {
    auth.as('demo-teacher');
    const g = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['שם־סודי'], topicId: 't-S054' });
    await api.setGroupStatus(g.id, 'done');
    auth.as('demo-admin');
    const old = await api.exportBackup(true);
    await api.closeCycle(YEAR, { force: true });
    const closedHistory = await getDoc(`schoolHistory/${DEMO_SCHOOL_ID}_${YEAR}`);
    const preview = await api.previewRestore(old, 'overwrite');
    expect(preview.report.groups.skippedClosed).toBeGreaterThan(0);
    await api.restoreBackup(old, { mode: 'overwrite' });
    expect(await getDoc(`schoolHistory/${DEMO_SCHOOL_ID}_${YEAR}`)).toEqual(closedHistory);
    expect(JSON.stringify(store.dump())).not.toContain('שם־סודי');
  });
  it('קובץ שאינו גיבוי נדחה', async () => {
    auth.as('demo-admin');
    await expect(api.previewRestore({ format: 'other', data: {} } as any)).rejects.toThrow(/פורמט/);
    await expect(api.restoreBackup({ format: 'mat-backup-1', data: null } as any)).rejects.toThrow(/פורמט/);
  });
  it('גיבוי בפורמט הישן (v1) עדיין נקרא', async () => {
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    const v1 = { ...b, format: 'mat-backup-1' as const };
    await expect(api.previewRestore(v1)).resolves.toBeTruthy();
  });
});

describe('ניקוי מחזור: מה נמחק ומה נשאר', () => {
  it('נשארים: נושאים, מקורות, בקשות (בלי הפניה לקבוצה), פרופילים, שיוך, היסטוריה ויומן; נמחקות: קבוצות ושמות', async () => {
    auth.as('demo-teacher');
    const g = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['שם־סודי'], topicId: 't-S054' });
    const r = await api.createRequest({ kind: 'inquiry', description: 'שאלה כללית', groupId: g.id });
    auth.as('demo-admin');
    const topicsBefore = (await store.list('topics')).length;
    const sourcesBefore = (await store.list('sources')).length;
    await api.closeCycle(YEAR, { force: true });
    expect((await store.list('groups')).filter((x: any) => x.yearId === YEAR)).toHaveLength(0);
    expect((await store.list('topics')).length).toBe(topicsBefore);
    expect((await store.list('sources')).length).toBe(sourcesBefore);
    expect((await store.list('profiles')).length).toBeGreaterThan(0);
    expect((await store.list('allowedTeachers')).length).toBeGreaterThan(0);
    expect(await getDoc(`requests/${r.id}`)).toMatchObject({ groupId: '' });
    expect(await getDoc(`deletionLedger/${YEAR}`)).not.toBeNull();
    expect((await getDoc(`schoolHistory/${DEMO_SCHOOL_ID}_${YEAR}`)).items.length).toBeGreaterThan(0);
  });
  it('סגירה של יותר מ-400 קבוצות (כתיבה בקבוצות) מוחקת את כולן', async () => {
    auth.as('demo-admin');
    const ops = [];
    for (let i = 0; i < 450; i++) ops.push({ op: 'set' as const, path: `groups/bulk${i}`, data: { ownerUid: 'u', schoolId: DEMO_SCHOOL_ID, yearId: YEAR, topicId: 't-S054', studentCount: 1, students: [{ label: 'שם־סודי' }], status: 'self_check', casesDeclared: 0, ruleVersionAtCheck: null, createdAt: 0, updatedAt: 0 } });
    await store.batch(ops);
    const res = await api.closeCycle(YEAR, { force: true });
    expect(res.deleted).toBeGreaterThanOrEqual(450);
    expect(JSON.stringify(store.dump())).not.toContain('שם־סודי');
  });
});
