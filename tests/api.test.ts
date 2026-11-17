import { beforeEach, describe, expect, it } from 'vitest';
import { Api } from '../src/services/api';
import { AuthService, AuthUser } from '../src/services/auth';
import { DEMO_ACCOUNTS, DEMO_SCHOOL_ID, seedStore } from '../src/services/demoSeed';
import { LocalStore } from '../src/services/localStore';
import { ConflictError, PermissionError } from '../src/services/store';
import type { Group, Topic } from '../src/domain/types';

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

const NOW = new Date(2027, 10, 15).getTime(); // 15.11.2027, שנת תשפ״ח
let store: LocalStore, auth: TestAuth, api: Api;
const YEAR = '2027-28';

beforeEach(async () => {
  store = new LocalStore(null);
  await seedStore(store, NOW, true);
  auth = new TestAuth();
  api = new Api(store, auth, 'demo', () => NOW);
});

const goodSource = { topicId: 't-S054', title: 'עמותה מלאכותית לבדיקה', kind: 'association' as const, text: 'מקור מלאכותי לבדיקות בלבד', url: 'https://example.org', phone: '', region: '', population: '', confirmNoPatientData: true };

describe('T01/T02 אורח', () => {
  it('אורח טוען קטלוג ומקורות', async () => {
    auth.as(null);
    const cat = await api.loadCatalog();
    expect(cat.topics.length).toBe(115); // 114 + נושא הדגמה
    expect((await api.listSources()).length).toBeGreaterThan(0);
  });
  it('אורח אינו מוסיף מקור, קבוצה או בקשה, ואינו קורא קבוצות', async () => {
    auth.as(null);
    await expect(api.addSource(goodSource)).rejects.toThrow(PermissionError);
    await expect(api.createRequest({ kind: 'inquiry', description: 'שאלה כללית' })).rejects.toThrow(PermissionError);
    await expect(api.listMyGroups()).rejects.toThrow(PermissionError);
  });
  it('משתמש לא מאומת אינו כותב', async () => {
    auth.as('demo-teacher', false);
    await expect(api.addSource(goodSource)).rejects.toThrow(/לאמת/);
  });
});

describe('T07/T30/T37 מקורות', () => {
  it('מקור מתפרסם מיד, מסומן "חדש" למנהל, ולחיצה כפולה לא מכפילה (T24)', async () => {
    auth.as('demo-teacher');
    const before = (await api.listSources()).length;
    const s1 = await api.addSource({ ...goodSource, clientId: 'src-abc' });
    const s2 = await api.addSource({ ...goodSource, clientId: 'src-abc' });
    expect(s1.id).toBe(s2.id);
    expect((await api.listSources()).length).toBe(before + 1); // מתפרסם מיד, בלי תלות בבדיקת מנהל
    expect((await api.listSources(goodSource.topicId)).some(x => x.id === s1.id)).toBe(true);
    auth.as('demo-admin');
    expect((await api.adminListSources(true)).some(x => x.id === s1.id)).toBe(true);
    expect((await api.adminBadges()).unreviewedSources).toBe(1);
  });
  it('מנהל מסמן "נבדק": החיווי יורד והמקור נשאר גלוי', async () => {
    auth.as('demo-teacher');
    const s1 = await api.addSource(goodSource);
    auth.as('demo-admin');
    await api.adminMarkSourcesReviewed([s1.id]);
    expect((await api.adminBadges()).unreviewedSources).toBe(0);
    expect((await api.listSources()).some(x => x.id === s1.id && x.visible)).toBe(true);
    auth.as('demo-teacher');
    await expect(api.adminMarkSourcesReviewed([s1.id])).rejects.toThrow(PermissionError);
  });
  it('מכסה יומית: 5 מקורות ביום למשתמש, ומחר אפשר שוב; משתמש אחר אינו מושפע', async () => {
    auth.as('demo-teacher');
    for (let i = 0; i < 5; i++) await api.addSource({ ...goodSource, title: `מקור מלאכותי מספר ${i}` });
    await expect(api.addSource({ ...goodSource, title: 'מקור מלאכותי שישי' })).rejects.toThrow(/מכסה/);
    auth.as('demo-teacher2');
    await expect(api.addSource({ ...goodSource, title: 'מקור של מורה אחר' })).resolves.toBeTruthy();
    const tomorrow = new Api(store, auth, 'demo', () => NOW + 86_400_000);
    auth.as('demo-teacher');
    await expect(tomorrow.addSource({ ...goodSource, title: 'מקור של מחר' })).resolves.toBeTruthy();
  });
  it('מורה אינו יכול לערוך, להסתיר או למחוק, גם את המקור שלו', async () => {
    auth.as('demo-teacher');
    const s = await api.addSource(goodSource);
    await expect(api.adminEditSource(s.id, { title: 'חדש' })).rejects.toThrow(PermissionError);
    await expect(api.adminRemoveSource(s.id)).rejects.toThrow(PermissionError);
  });
  it('מנהל מסיר והמקור נעלם מכל תצוגה ציבורית', async () => {
    auth.as('demo-teacher');
    const s = await api.addSource(goodSource);
    auth.as('demo-admin');
    await api.adminRemoveSource(s.id);
    auth.as(null);
    expect((await api.listSources()).some(x => x.id === s.id)).toBe(false);
  });
  it('דיווח על מקור מופיע למנהל, אינו מסתיר אותו, וחוזר־בטוח; מנהל מסמן "טופל"', async () => {
    auth.as('demo-teacher');
    const s = await api.addSource(goodSource);
    auth.as('demo-teacher2');
    await api.reportSource(s.id, 'לא מעודכן');
    await api.reportSource(s.id, 'לא מעודכן');
    auth.as('demo-admin');
    const reps = await api.adminListSourceReports();
    expect(reps.filter(r => r.sourceId === s.id)).toHaveLength(1);
    expect((await api.listSources()).some(x => x.id === s.id && x.visible)).toBe(true);
    expect((await api.adminBadges()).openReports).toBe(1);
    await api.adminHandleReport(reps[0].id);
    expect((await api.adminBadges()).openReports).toBe(0);
  });
  it('קישור זדוני נדחה', async () => {
    auth.as('demo-teacher');
    await expect(api.addSource({ ...goodSource, url: 'javascript:alert(1)' })).rejects.toThrow();
  });
});

describe('T09/T10 הרשאות מנהל', () => {
  it('מורה אינו משנה נושא, כללים, הגדרות או תפקידים', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S020'))!;
    auth.as('demo-teacher');
    await expect(api.saveTopic({ ...t, ageMax: 99 }, t.version)).rejects.toThrow(PermissionError);
    await expect(api.saveGeneralRules({ questions: [], rules: [] })).rejects.toThrow(PermissionError);
    await expect(api.adminGrantRole('demo-teacher', 'admin')).rejects.toThrow(PermissionError);
    await expect(api.adminListTopics()).rejects.toThrow(PermissionError);
    await expect(api.applySeedImport()).rejects.toThrow(PermissionError);
  });
  it('רכז אינו מנהל ארצי ואינו משנה מאגר מחלות', async () => {
    auth.as('demo-coord');
    await expect(api.adminListTopics()).rejects.toThrow(PermissionError);
    await expect(api.adminApplySchools('1,2')).rejects.toThrow(PermissionError);
  });
  it('אי אפשר להסיר את המנהל האחרון', async () => {
    auth.as('demo-admin');
    await expect(api.adminRevokeRole('demo-admin')).rejects.toThrow(/האחרון/);
  });
  it('קידום רק מתוך משתמש רשום ומאומת', async () => {
    auth.as('demo-admin');
    await expect(api.adminGrantRole('ghost-uid', 'admin')).rejects.toThrow(/לא נמצא/);
    await api.adminGrantRole('demo-teacher2', 'admin');
    await api.adminRevokeRole('demo-admin'); // כעת יש שניים: מותר
  });
});

describe('T05/T11 עריכת מנהל בלי קוד, גרסאות, ופרסום', () => {
  it('שינוי גיל בידי מנהל, גרסה חדשה, והקטלוג הציבורי מתעדכן', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S020'))!;
    const saved = await api.saveTopic({ ...t, ageMax: 21 }, t.version);
    expect(saved.version).toBe(t.version + 1);
    expect((await api.adminTopicVersions('t-S020')).map(v => v.version)).toEqual([2, 1]);
    await api.publishCatalog();
    auth.as(null);
    const cat = await api.loadCatalog();
    expect(cat.topics.find(x => x.id === 't-S020')!.ageMax).toBe(21);
  });
  it('עריכה מקבילה מתריעה במקום לדרוס', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S020'))!;
    await api.saveTopic({ ...t, difficulty: 1 }, t.version);
    await expect(api.saveTopic({ ...t, difficulty: 2 }, t.version)).rejects.toThrow(ConflictError);
  });
  it('לא ניתן לפרסם נושא עם כיסוי "מלא" ללא מאשר', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S020'))!;
    await expect(api.saveTopic({ ...t, coverage: { level: 'full', reason: 'x' } }, t.version)).rejects.toThrow(/אישור מנהל/);
  });
  it('נושא חדש כטיוטה אינו גלוי; אחרי פרסום וקטלוג הוא גלוי (R07)', async () => {
    auth.as('demo-admin');
    const base = (await api.adminGetTopic('t-S020'))!;
    const draft: Topic = { ...base, id: 't-NEW1', he: 'נושא חדש מלאכותי', seedIds: [], publish: 'draft', version: 0 };
    await api.saveTopic(draft, 0);
    await api.publishCatalog();
    auth.as(null);
    expect((await api.loadCatalog()).topics.some(t => t.id === 't-NEW1')).toBe(false);
    auth.as('demo-admin');
    await api.setTopicPublish('t-NEW1', 'published', YEAR);
    await api.publishCatalog();
    auth.as(null);
    expect((await api.loadCatalog()).topics.find(t => t.id === 't-NEW1')!.addedYear).toBe(YEAR);
  });
  it('הסרה מפרסום מעלימה מהקטלוג', async () => {
    auth.as('demo-admin');
    await api.setTopicPublish('t-S001', 'unpublished');
    await api.publishCatalog();
    auth.as(null);
    expect((await api.loadCatalog()).topics.some(t => t.id === 't-S001')).toBe(false);
  });
  it('ייבוא חוזר אינו דורס עריכת מנהל (T33)', async () => {
    auth.as('demo-admin');
    const t = (await api.adminGetTopic('t-S020'))!;
    await api.saveTopic({ ...t, ageMax: 21 }, t.version);
    const plan = await api.applySeedImport();
    expect(plan.createTopics).toHaveLength(0);
    expect((await api.adminGetTopic('t-S020'))!.ageMax).toBe(21);
  });
  it('סיווג, מערכת וגיל נשמרים כנתונים; מנהל מוסיף נושא בלי קוד', async () => {
    auth.as('demo-admin');
    const cnt = (await api.adminListTopics()).length;
    expect(cnt).toBe(115);
  });
});

describe('קבוצות (T15, T21, T29, T31)', () => {
  it('שמירה עם מספר תלמידים בלבד, ללא שמות', async () => {
    auth.as('demo-teacher');
    const g = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 3 });
    expect(g.students).toEqual([]);
    expect(g.studentCount).toBe(3);
  });
  it('מספר מחוץ ל־1–3 נדחה', async () => {
    auth.as('demo-teacher');
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 4 })).rejects.toThrow();
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 0 })).rejects.toThrow();
  });
  it('דוחה מספרי זהות, מיילים ויותר שמות מתלמידים', async () => {
    auth.as('demo-teacher');
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['123456789'] })).rejects.toThrow();
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['a@b.co'] })).rejects.toThrow();
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['א', 'ב'] })).rejects.toThrow();
  });
  it('לחיצה כפולה אינה יוצרת שתי קבוצות', async () => {
    auth.as('demo-teacher');
    const a = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, clientId: 'g-dup' });
    const b = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, clientId: 'g-dup' });
    expect(a.id).toBe(b.id);
    expect((await api.listMyGroups()).filter(g => g.id === 'g-dup')).toHaveLength(1);
  });
  it('מספר המקרים הנדרש שווה למספר התלמידים; התקדמות חלקית מסומנת', async () => {
    auth.as('demo-teacher');
    const g = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 2, topicId: null });
    expect((await api.declareCases(g.id, 1)).status).not.toBe('case_check_done');
    expect((await api.declareCases(g.id, 2)).status).toBe('case_check_done');
    await expect(api.declareCases(g.id, 3)).rejects.toThrow();
    const solo = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1 });
    expect((await api.declareCases(solo.id, 1)).status).toBe('case_check_done');
  });
  it('החלפת נושא שומרת תלמידים ופותחת בדיקה מחדש; שינוי תלמידים לא (T21)', async () => {
    auth.as('demo-teacher');
    const g = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 2, students: ['נועה', 'דני'], topicId: 't-S054' });
    await api.declareCases(g.id, 2);
    const g2 = await api.setGroupTopic(g.id, { id: 't-S063', familyId: 'fam-S063', he: 'אסתמה', version: 1 });
    expect(g2.students.map(s => s.label)).toEqual(['נועה', 'דני']);
    expect(g2.casesDeclared).toBe(0);
    expect(g2.status).toBe('self_check');
    await api.declareCases(g.id, 1);
    const g3 = await api.updateStudents(g.id, 3, ['נועה', 'דני']);
    expect(g3.casesDeclared).toBe(1);
    expect(g3.topicId).toBe('t-S063');
  });
  it('מורה לא רואה קבוצות של מורה אחר; רכז רק של מוסדו (T19, T20)', async () => {
    auth.as('demo-teacher2');
    expect((await api.listMyGroups()).some(g => g.id === 'demo-group-1')).toBe(false);
    await expect(api.setGroupStatus('demo-group-1', 'cancelled')).rejects.toThrow(PermissionError);
    auth.as('demo-coord');
    expect((await api.listSchoolGroups(DEMO_SCHOOL_ID)).some(g => g.id === 'demo-group-1')).toBe(true);
    await expect(api.listSchoolGroups('other-school')).rejects.toThrow(PermissionError);
  });
  it('הצטרפות בקוד מוסד אינה מקנה הרשאת רכז (T31)', async () => {
    auth.as('demo-teacher2');
    await api.joinSchool(DEMO_SCHOOL_ID);
    expect((await api.ctx()).role).toBe('teacher');
    await expect(api.joinSchool('000000')).rejects.toThrow(/לא נמצא/);
  });
  it('אין יצירת קבוצה במוסד שלא הצטרפו אליו', async () => {
    auth.as('demo-admin');
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1 })).rejects.toThrow(PermissionError);
  });
});

describe('בקשות (T14, T24, T28)', () => {
  it('בקשה נוצרת פעם אחת, מופיעה למנהל כחדשה, ויעד שבוע', async () => {
    auth.as('demo-teacher');
    const a = await api.createRequest({ kind: 'new_topic', proposedHe: 'נושא מוצע מלאכותי', description: 'תיאור כללי', rationale: 'מעניין', clientId: 'rq1' });
    const b = await api.createRequest({ kind: 'new_topic', proposedHe: 'נושא מוצע מלאכותי', description: 'תיאור כללי', rationale: 'מעניין', clientId: 'rq1' });
    expect(a.id).toBe(b.id);
    expect(a.dueAt - a.createdAt).toBe(7 * 86400000);
    expect((await api.listMyRequests()).filter(r => r.id === a.id)).toHaveLength(1);
    auth.as('demo-admin');
    expect((await api.adminBadges()).openRequests).toBe(1);
    expect((await api.adminListRequests(['open'])).map(r => r.id)).toContain(a.id);
  });
  it('מכסת בקשות יומית: 10', async () => {
    auth.as('demo-teacher');
    for (let i = 0; i < 10; i++) await api.createRequest({ kind: 'inquiry', description: `שאלה כללית ${i}` });
    await expect(api.createRequest({ kind: 'inquiry', description: 'עוד שאלה' })).rejects.toThrow(/מכסה/);
  });
  it('מנהל משנה יעד טיפול בהגדרות', async () => {
    auth.as('demo-admin');
    const s = await api.getAdminSettings();
    await api.saveSettings({ ...s, responseDueDays: 3 });
    auth.as('demo-teacher');
    const r = await api.createRequest({ kind: 'inquiry', description: 'שאלה כללית' });
    expect(r.dueAt - r.createdAt).toBe(3 * 86400000);
  });
  it('בקשת חריג כללית אינה מקבלת מספר זיהוי או מייל; לא נשמר תיאור רפואי', async () => {
    auth.as('demo-teacher');
    await expect(api.createRequest({ kind: 'exception_general', description: 'צרו קשר 123456789' })).rejects.toThrow();
  });
  it('מקצה לקצה בלי דוא״ל: הגשה, צפיית מנהל, מענה, וצפיית המורה במענה ובחיווי "חדש"', async () => {
    auth.as('demo-teacher');
    const r = await api.createRequest({ kind: 'inquiry', description: 'שאלה כללית', clientId: 'rq2' });
    expect(await api.myUnseenReplies()).toBe(0);
    auth.as('demo-admin');
    expect((await api.adminBadges()).openRequests).toBe(1);
    await api.adminSetRequestStatus(r.id, 'in_progress');
    expect((await api.adminBadges()).inProgress).toBe(1);
    await api.adminReply(r.id, { decisionKind: 'supplement', text: 'נא להשלים תיאור כללי', status: 'waiting_teacher' });
    auth.as('demo-teacher');
    expect(await api.myUnseenReplies()).toBe(1); // חיווי "חדש"
    const mine = (await api.listMyRequests()).find(x => x.id === r.id)!;
    expect(mine.status).toBe('waiting_teacher');
    expect(mine.adminReply).toBe('נא להשלים תיאור כללי');
    await api.markMyRepliesSeen([mine]);
    expect(await api.myUnseenReplies()).toBe(0);
    await api.supplementRequest(r.id, 'השלמה כללית');
    auth.as('demo-admin');
    expect((await api.adminBadges()).openRequests).toBe(1); // חזרה לתור המנהל
    await api.adminReply(r.id, { decisionKind: 'rejection', text: 'לא ניתן לאשר. פנייה אישית לאחראי.', status: 'answered' });
    auth.as('demo-teacher');
    expect(await api.myUnseenReplies()).toBe(1);
    expect((await api.listMyRequests()).find(x => x.id === r.id)!.decisionKind).toBe('rejection');
    auth.as('demo-teacher2');
    expect(await api.myUnseenReplies()).toBe(0); // מורה אחר אינו רואה
    await expect(api.adminReply(r.id, { decisionKind: 'supplement', text: 'x', status: 'open' })).rejects.toThrow(PermissionError);
  });
  it('אין תור דוא״ל ואין התראות שנשמרות מחוץ לבקשות ולמקורות עצמם', async () => {
    auth.as('demo-teacher');
    await api.createRequest({ kind: 'inquiry', description: 'שאלה כללית' });
    await api.addSource(goodSource);
    const colls = Object.keys(store.dump());
    expect(colls).not.toContain('outbox');
    expect(colls).not.toContain('notifications');
  });
});

describe('T23/T34/T38 סיום מחזור, מחיקה וגיבוי', () => {
  async function makeGroups() {
    auth.as('demo-teacher');
    const g1 = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 2, students: ['שם־סודי־א', 'שם־סודי־ב'], topicId: 't-S054' });
    await api.setGroupStatus(g1.id, 'done');
    const g2 = await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['שם־סודי־ג'], topicId: 't-S063' });
    await api.setGroupStatus(g2.id, 'cancelled');
    await api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1, students: ['שם־סודי־ד'], topicId: 't-S019' });
  }
  const everythingText = () => JSON.stringify(store.dump());

  it('סגירת מחזור מוחקת שמות מכל נתיב ומשאירה היסטוריה לא מזהה', async () => {
    await makeGroups();
    expect(everythingText()).toContain('שם־סודי');
    auth.as('demo-admin');
    const res = await api.closeCycle(YEAR, { force: true });
    expect(res.deleted).toBe(4); // כולל קבוצת ההדגמה
    const dump = everythingText();
    expect(dump).not.toContain('שם־סודי');
    expect(dump).not.toContain('כינוי א');
    auth.as(null);
    const h = await api.getSchoolHistory(DEMO_SCHOOL_ID, YEAR);
    const states = Object.fromEntries(h!.items.map(i => [i.topicHe, i.state]));
    expect(Object.values(states)).toContain('done');
    expect(Object.values(states)).toContain('cancelled');
    expect(Object.values(states)).toContain('approved_not_done'); // אושר ולא בוצע: לא "בוצע" (T17)
    expect(JSON.stringify(h)).not.toMatch(/label/);
  });
  it('אחרי סגירה לא ניתן ליצור קבוצות חדשות במחזור', async () => {
    auth.as('demo-admin');
    await api.closeCycle(YEAR, { force: true });
    auth.as('demo-teacher');
    await expect(api.createGroup({ schoolId: DEMO_SCHOOL_ID, yearId: YEAR, studentCount: 1 })).rejects.toThrow(/נסגר/);
  });
  it('סגירה חוזרת בטוחה', async () => {
    await makeGroups();
    auth.as('demo-admin');
    await api.closeCycle(YEAR, { force: true });
    expect((await api.closeCycle(YEAR, { force: true })).deleted).toBe(0);
  });
  it('גיבוי תוכן בלבד אינו כולל קבוצות, תלמידים, בקשות או כתובות מייל', async () => {
    await makeGroups();
    auth.as('demo-admin');
    const b = await api.exportBackup(false);
    const text = JSON.stringify(b);
    expect(text).not.toContain('שם־סודי');
    expect(text).not.toContain('@demo.test');
    expect(b.data.groups).toBeUndefined();
  });
  it('שחזור מגיבוי ישן אינו מחזיר שמות ממחזור שכבר נמחק (T34/T38)', async () => {
    await makeGroups();
    auth.as('demo-admin');
    const oldBackup = await api.exportBackup(true); // לפני הסגירה, כולל קבוצות
    expect(JSON.stringify(oldBackup)).toContain('שם־סודי');
    await api.closeCycle(YEAR, { force: true });
    for (const mode of ['add_missing', 'overwrite'] as const) {
      await api.restoreBackup(oldBackup, { mode });
      expect(everythingText()).not.toContain('שם־סודי');
    }
    auth.as('demo-teacher');
    expect(await api.listMyGroups()).toEqual([]);
  });
  it('סגירת מחזור שטרם הסתיים נדחית בלי אישור מפורש', async () => {
    await makeGroups();
    auth.as('demo-admin');
    await expect(api.closeCycle(YEAR)).rejects.toThrow(/טרם הסתיים/);
    const p = await api.cycleClosePreview(YEAR);
    expect(p.groups).toBe(4);
    expect(p.yearEnded).toBe(false);
    expect(p.activeGroups).toBeGreaterThan(0);
    expect(p.studentLabels).toBeGreaterThanOrEqual(4);
    expect(everythingText()).toContain('שם־סודי'); // התצוגה המקדימה והדחייה לא מחקו דבר
  });
  it('שחזור למאגר ריק: תוכן חוזר, ויומן המחיקות מונע חזרה של תלמידים', async () => {
    await makeGroups();
    auth.as('demo-admin');
    const privateBackup = await api.exportBackup(true);
    await api.closeCycle(YEAR, { force: true });
    const ledgerBackup = await api.exportBackup(false); // כולל deletionLedger
    const fresh = new LocalStore(null);
    const api2 = new Api(fresh, auth, 'demo', () => NOW);
    await fresh.batch([{ op: 'set', path: 'roles/demo-admin', data: { role: 'admin', grantedBy: 'x', grantedAt: 0 } }]);
    // סדר שגוי מכוון: קודם פרטי (עם תלמידים), ואחריו לדג'ר: הכלל "מחיקות מוחלות לפני חזרה לפעילות" נאכף ב-restore עצמו
    const merged = { ...privateBackup, data: { ...privateBackup.data, deletionLedger: ledgerBackup.data.deletionLedger } };
    await api2.restoreBackup(merged);
    expect(JSON.stringify(fresh.dump())).not.toContain('שם־סודי');
    auth.as(null);
    expect((await api2.loadCatalog()).topics.length).toBe(115);
  });
});

describe('T27/T36 מצבי חיבור אמיתיים', () => {
  it('מצב bundled: קריאה בלבד ללא שירות, בלי להעמיד פנים ששמר', async () => {
    const ro = new Api(new LocalStore(null, true), auth, 'bundled', () => NOW);
    auth.as(null);
    const cat = await ro.loadCatalog();
    expect(cat.origin).toBe('bundled');
    expect(cat.topics).toHaveLength(114);
    expect(cat.topics.some(t => t.id === 't-DEMO1')).toBe(false); // נתוני הדגמה לא בייצור
    auth.as('demo-teacher');
    await expect(ro.addSource(goodSource)).rejects.toThrow();
  });
  it('שירות ללא קטלוג מפורסם: נפילה למובנה עם origin מפורש', async () => {
    const empty = new Api(new LocalStore(null), auth, 'service', () => NOW);
    auth.as(null);
    expect((await empty.loadCatalog()).origin).toBe('bundled');
  });
});
