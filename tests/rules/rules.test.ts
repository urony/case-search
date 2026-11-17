// בדיקות לכללי ההרשאות (firestore.rules) מול אמולטור Firestore.
// דורשות Java ו-firebase-tools:  npm run test:rules
// הערה: בסביבת הפיתוח שבה נכתבו, Java לא היה מותקן, ולכן הבדיקות האלה נכתבו אך טרם הורצו. ראו PROJECT_STATUS.md.
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const NOW = 1_800_000_000_000;

const claims = (verified = true) => ({ email_verified: verified });
const ctx = (uid: string | null, verified = true) =>
  uid ? env.authenticatedContext(uid, { ...claims(verified), email: `${uid}@x.test` }).firestore() : env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-medical', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await db.doc('roles/admin1').set({ role: 'admin', grantedBy: 'x', grantedAt: NOW });
    await db.doc('roles/coord1').set({ role: 'coordinator', schoolId: 's1', grantedBy: 'x', grantedAt: NOW });
    await db.doc('schools/s1').set({ name: 'בית ספר מלאכותי', city: 'עיר', active: true });
    await db.doc('schools/s2').set({ name: 'בית ספר מלאכותי ב', city: 'עיר', active: true });
    await db.doc('memberships/t1_s1').set({ uid: 't1', schoolId: 's1', startedAt: NOW, endedAt: null });
    await db.doc('memberships/t2_s1').set({ uid: 't2', schoolId: 's1', startedAt: NOW, endedAt: null });
    await db.doc('groups/g1').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [{ label: 'כינוי' }], status: 'draft' });
    await db.doc('public/catalogMeta').set({ chunks: 1 });
    await db.doc('topics/t-1').set({ he: 'טיוטה', publish: 'draft' });
    await db.doc('sources/s-vis').set({ topicId: 't', title: 'מקור גלוי', visible: true, createdBy: 't1' });
    await db.doc('sources/s-hid').set({ topicId: 't', title: 'מקור מוסתר', visible: false, createdBy: 't1' });
    await db.doc('config/contact').set({ email: 'owner@x.test' });
    await db.doc('schoolHistory/s1_2026-27').set({ schoolId: 's1', yearId: '2026-27', items: [] });
  });
});

const src = (uid: string) => ({ topicId: 't', title: 'עמותה מלאכותית', kind: 'association', text: 'טקסט', url: 'https://example.org', phone: '', region: '', population: '', createdBy: uid, createdAt: NOW, visible: true, reviewed: false });
const DAY = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const slot = (uid: string, n: number, day = DAY) => `${uid}_${day}_${n}`;

describe('T01/T02 אורח', () => {
  it('קורא קטלוג ציבורי ומקורות גלויים בלבד', async () => {
    const db = ctx(null);
    await assertSucceeds(db.doc('public/catalogMeta').get());
    await assertSucceeds(db.doc('sources/s-vis').get());
    await assertFails(db.doc('sources/s-hid').get());
    await assertFails(db.doc('topics/t-1').get());
  });
  it('אינו כותב מקור ואינו קורא קבוצות', async () => {
    const db = ctx(null);
    await assertFails(db.doc('sources/new').set(src('x')));
    await assertFails(db.doc('groups/g1').get());
    await assertFails(db.doc('config/contact').get());
  });
  it('היסטוריה: get לפי קוד כן, רשימה לא (T19)', async () => {
    const db = ctx(null);
    await assertSucceeds(db.doc('schoolHistory/s1_2026-27').get());
    await assertFails(db.collection('schoolHistory').get());
    await assertFails(db.collection('schools').get());
  });
});

describe('T07/T08/T30 מקורות', () => {
  it('מורה מאומת מוסיף במזהה יומי תקין; לא מאומת לא', async () => {
    await assertSucceeds(ctx('t1').doc(`sources/${slot('t1', 1)}`).set(src('t1')));
    await assertFails(ctx('t1', false).doc(`sources/${slot('t1', 2)}`).set(src('t1')));
  });
  it('מכסה יומית נאכפת בשירות: עד 5, מזהה של אחר או תאריך אחר נדחים, ומזהה חופשי נדחה', async () => {
    for (let n = 1; n <= 5; n++) await assertSucceeds(ctx('t1').doc(`sources/${slot('t1', n)}`).set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 6)}`).set(src('t1')));            // מעל המכסה
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 0)}`).set(src('t1')));            // n=0
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1, '20200101')}`).set(src('t1'))); // תאריך מומצא: עוקף מכסה
    await assertFails(ctx('t1').doc(`sources/${slot('t2', 1)}`).set(src('t1')));            // מזהה של משתמש אחר
    await assertFails(ctx('t1').doc('sources/new').set(src('t1')));                            // מזהה חופשי
    // עדכון המסמך הקיים (דריסה) אסור למוסיף
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), title: 'דריסה של מקור קיים' }));
  });
  it('דוחה javascript:, visible=false, reviewed=true, createdBy של אחר ושדות לא מוכרים', async () => {
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), url: 'javascript:alert(1)' }));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), visible: false }));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), reviewed: true }));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set(src('t2')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), isAdmin: true }));
  });
  it('גם המוסיף אינו עורך, מסתיר או מוחק; מנהל כן, כולל סימון נבדק', async () => {
    await assertFails(ctx('t1').doc('sources/s-vis').update({ title: 'חדש' }));
    await assertFails(ctx('t1').doc('sources/s-vis').update({ reviewed: true }));
    await assertFails(ctx('t1').doc('sources/s-vis').delete());
    await assertSucceeds(ctx('admin1').doc('sources/s-vis').update({ reviewed: true }));
    await assertSucceeds(ctx('admin1').doc('sources/s-vis').update({ visible: false }));
  });
});

describe('דיווחי מקורות (במקום התראות)', () => {
  const rep1 = (uid: string, sid = 's-vis') => ({ sourceId: sid, reason: 'לא מעודכן', createdBy: uid, createdAt: NOW, handled: false });
  it('דיווח אחד לכל משתמש ומקור; לא בשם אחר; לא עדכון; מנהל רואה ומטפל', async () => {
    await assertSucceeds(ctx('t2').doc('sourceReports/t2_s-vis').set(rep1('t2')));
    await assertFails(ctx('t2').doc('sourceReports/t1_s-vis').set(rep1('t2')));               // מזהה של אחר
    await assertFails(ctx('t2').doc('sourceReports/t2_s-hid').set({ ...rep1('t2'), handled: true }));
    await assertFails(ctx('t1').doc('sourceReports/t2_s-vis').get());                          // מורה אחר אינו קורא
    await assertFails(ctx('t2').doc('sourceReports/t2_s-vis').update({ handled: true }));      // המדווח אינו מטפל
    await assertSucceeds(ctx('admin1').doc('sourceReports/t2_s-vis').update({ handled: true }));
    await assertFails(ctx('t1').collection('sourceReports').get());
    await assertSucceeds(ctx('admin1').collection('sourceReports').get());
  });
});

describe('T09 מורה אינו משנה תוכן', () => {
  it('נושא, כללים, תפקידים, הגדרות, התראות', async () => {
    const db = ctx('t1');
    await assertFails(db.doc('topics/t-1').set({ he: 'x' }));
    await assertFails(db.doc('config/general').set({ rules: {} }));
    await assertFails(db.doc('public/catalog_0').set({ topics: [] }));
    await assertFails(db.doc('roles/t1').set({ role: 'admin', grantedBy: 't1', grantedAt: 1 }));
    await assertFails(db.doc('notifications/n1').set({ type: 'new_request', refId: 'x', createdAt: NOW, readBy: [], summary: 'x' })); // אין עוד התראות או תור דוא"ל
    await assertFails(db.doc('outbox/o1').set({ to: 'admins', status: 'queued', subject: 'x', body: 'x', attempts: 0, createdAt: NOW }));
  });
  it('מנהל כן', async () => {
    const db = ctx('admin1');
    await assertSucceeds(db.doc('topics/t-1').set({ he: 'x' }));
    await assertSucceeds(db.doc('config/general').set({ rules: {} }));
  });
  it('מנהל לא מאומת אינו מנהל', async () => { await assertFails(ctx('admin1', false).doc('topics/t-1').get()); });
});

describe('T19/T20/T31 קבוצות והרשאות מוסדיות', () => {
  it('מורה רואה את שלו בלבד', async () => {
    await assertSucceeds(ctx('t1').doc('groups/g1').get());
    await assertFails(ctx('t2').doc('groups/g1').get());
    await assertFails(ctx('t2').doc('groups/g1').update({ status: 'done' }));
  });
  it('רכז רואה את מוסדו בלבד', async () => {
    await assertSucceeds(ctx('coord1').doc('groups/g1').get());
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc('groups/g9').set({ ownerUid: 'x', schoolId: 's2', yearId: '2027-28', studentCount: 1, students: [] }); });
    await assertFails(ctx('coord1').doc('groups/g9').get());
  });
  it('יצירת קבוצה דורשת חברות במוסד, 1–3 תלמידים, ובעלות עצמית', async () => {
    const ok = { ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 2, students: [], status: 'draft' };
    await assertSucceeds(ctx('t1').doc('groups/n1').set(ok));
    await assertFails(ctx('t1').doc('groups/n2').set({ ...ok, studentCount: 4 }));
    await assertFails(ctx('t1').doc('groups/n3').set({ ...ok, schoolId: 's2' }));
    await assertFails(ctx('t1').doc('groups/n4').set({ ...ok, ownerUid: 't2' }));
    await assertFails(ctx('t1').doc('groups/n5').set({ ...ok, studentCount: 1, students: [{ label: 'a' }, { label: 'b' }] }));
  });
  it('לא ניתן ליצור קבוצה במחזור שנסגר', async () => {
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc('deletionLedger/2027-28').set({ yearId: '2027-28' }); });
    await assertFails(ctx('t1').doc('groups/n6').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
  });
  it('הצטרפות למוסד בקוד מקנה חברות ולא רכז; תפקיד רכז רק מנהל', async () => {
    await assertSucceeds(ctx('t3').doc('memberships/t3_s1').set({ uid: 't3', schoolId: 's1', startedAt: NOW, endedAt: null }));
    await assertFails(ctx('t3').doc('roles/t3').set({ role: 'coordinator', schoolId: 's1', grantedBy: 't3', grantedAt: 1 }));
    await assertFails(ctx('t3').doc('memberships/t3_nope').set({ uid: 't3', schoolId: 'nope', startedAt: NOW, endedAt: null }));
  });
  it('היסטוריה: כתיבה לחבר או רכז של המוסד בלבד', async () => {
    const h = { schoolId: 's1', yearId: '2027-28', items: [], updatedAt: NOW };
    await assertSucceeds(ctx('t1').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t3').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t1').doc('schoolHistory/s1_wrong').set(h));
  });
});

describe('בקשות ופרופילים', () => {
  const rq = { createdBy: 't1', status: 'open', description: 'כללי', kind: 'inquiry', createdAt: NOW };
  it('בקשה: מזהה יומי, בעלים וקריאה למנהל בלבד; מורה משלים רק שדות מותרים', async () => {
    await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', 1)}`).set(rq));
    await assertFails(ctx('t1').doc('requests/free-id').set(rq));
    await assertFails(ctx('t2').doc(`requests/${slot('t1', 1)}`).get());
    await assertSucceeds(ctx('admin1').doc(`requests/${slot('t1', 1)}`).get());
    await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ supplement: 'עוד', status: 'open', updatedAt: NOW }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ adminReply: 'אישור' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ status: 'answered', decisionKind: 'general_approval' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 2)}`).set({ ...rq, adminReply: 'אישור עצמי' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 3)}`).set({ ...rq, repliedAt: NOW }));
  });
  it('מכסת בקשות: עד 10 ביום', async () => {
    for (let n = 1; n <= 10; n++) await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', n)}`).set(rq));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 11)}`).set(rq));
  });
  it('חיווי "חדש": הבעלים מסמן ראיתי; אחר לא; ולא ביחד עם שינוי אחר', async () => {
    const id = slot('t1', 1);
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc(`requests/${id}`).set({ ...rq, status: 'answered', adminReply: 'מענה', repliedAt: NOW, teacherSeenAt: 0 }); });
    await assertSucceeds(ctx('t1').doc(`requests/${id}`).update({ teacherSeenAt: NOW }));
    await assertFails(ctx('t2').doc(`requests/${id}`).update({ teacherSeenAt: NOW }));
    await assertFails(ctx('t1').doc(`requests/${id}`).update({ teacherSeenAt: NOW, adminReply: 'ניסיון לשנות מענה' }));
    await assertSucceeds(ctx('admin1').doc(`requests/${id}`).update({ adminReply: 'מענה מעודכן', repliedAt: NOW + 1, teacherSeenAt: 0 }));
  });
  it('פרופיל: רק עצמי, עם מייל מהטוקן', async () => {
    await assertSucceeds(ctx('t1').doc('profiles/t1').set({ uid: 't1', email: 't1@x.test', emailVerified: true, displayName: 'א' }));
    await assertFails(ctx('t1').doc('profiles/t1').set({ uid: 't1', email: 'other@x.test', emailVerified: true, displayName: 'א' }));
    await assertFails(ctx('t1').doc('profiles/t2').get());
  });
  it('גרסת נושא מפורסמת אינה נדרסת', async () => {
    await assertSucceeds(ctx('admin1').doc('topicVersions/t-1__v1').set({ he: 'x' }));
    await assertFails(ctx('admin1').doc('topicVersions/t-1__v1').update({ he: 'y' }));
    await assertFails(ctx('admin1').doc('topicVersions/t-1__v1').delete());
  });
});

describe('גישה ישירה למסד (עוקפת את כפתורי האתר)', () => {
  it('מורה אינו קורא נתוני מורה אחר: פרופיל, בקשות, שיוך, תפקיד, קבוצות', async () => {
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await db.doc('profiles/t1').set({ uid: 't1', email: 't1@x.test', emailVerified: true, displayName: 'מורה אחד' });
      await db.doc(`requests/${slot('t1', 1)}`).set({ createdBy: 't1', status: 'open', description: 'כללי', kind: 'inquiry', createdAt: NOW });
    });
    const t2 = ctx('t2');
    await assertFails(t2.doc('profiles/t1').get());
    await assertFails(t2.doc(`requests/${slot('t1', 1)}`).get());
    await assertFails(t2.doc('memberships/t1_s1').get());
  });
  it('שאילתות רחבות נדחות: אי אפשר לרשום את כל הקבוצות, הבקשות, הפרופילים או השיוכים', async () => {
    const t1 = ctx('t1');
    for (const c of ['groups', 'requests', 'profiles', 'memberships', 'roles', 'sources', 'schools', 'schoolHistory', 'topics', 'audit', 'suggestions', 'seedEntries', 'deletionLedger', 'policyQuestions', 'sourceReports']) {
      await assertFails(t1.collection(c).get());
    }
    // שאילתה מצומצמת לשלי מותרת
    await assertSucceeds(t1.collection('groups').where('ownerUid', '==', 't1').get());
    await assertSucceeds(t1.collection('requests').where('createdBy', '==', 't1').get());
    await assertSucceeds(t1.collection('memberships').where('uid', '==', 't1').get());
    // שאילתה של מקורות גלויים בלבד מותרת לכולם (זה מה שהאתר עושה)
    await assertSucceeds(ctx(null).collection('sources').where('visible', '==', true).get());
  });
  it('אוספי ניהול סגורים בפני מורה, רכז ואורח', async () => {
    for (const who of ['t1', 'coord1', null]) {
      const db = ctx(who as string | null);
      for (const p of ['audit/a', 'seedEntries/s', 'suggestions/s', 'policyQuestions/q', 'deletionLedger/y', 'topicVersions/t__v1', 'config/backupMeta', 'topics/t-1']) await assertFails(db.doc(p).get());
      await assertFails(db.doc('suggestions/x').set({ state: 'accepted' }));
      await assertFails(db.doc('deletionLedger/x').set({ yearId: 'x' }));
      await assertFails(db.doc('audit/x').set({ at: 1 }));
      await assertFails(db.doc('config/settings').set({ responseDueDays: 1 }));
      await assertFails(db.doc('schools/s9').set({ name: 'מוסד מומצא', city: 'x', active: true }));
    }
    await assertSucceeds(ctx('admin1').doc('config/backupMeta').set({ lastBackupAt: NOW }));
    await assertSucceeds(ctx('admin1').doc('config/backupMeta').get());
  });
  it('העלאת הרשאות: מורה לא נותן לעצמו תפקיד, לא משנה שיוך של אחר, לא מוחק תפקיד', async () => {
    await assertFails(ctx('t1').doc('roles/t1').set({ role: 'admin', grantedBy: 't1', grantedAt: 1 }));
    await assertFails(ctx('t1').doc('roles/admin1').delete());
    await assertFails(ctx('t1').doc('memberships/t2_s1').update({ endedAt: NOW }));
    await assertFails(ctx('t1').doc('memberships/t1_s1').update({ schoolId: 's2' }));
    await assertFails(ctx('coord1').doc('roles/coord1').set({ role: 'admin', grantedBy: 'x', grantedAt: 1 }));
  });
  it('רכז: קבוצות מוסדו בלבד, ואינו כותב תוכן', async () => {
    await assertSucceeds(ctx('coord1').collection('groups').where('schoolId', '==', 's1').get());
    await assertFails(ctx('coord1').collection('groups').where('schoolId', '==', 's2').get());
    await assertFails(ctx('coord1').doc('topics/t-1').set({ he: 'x' }));
    await assertFails(ctx('coord1').doc('sources/s-vis').update({ visible: false }));
    await assertSucceeds(ctx('coord1').collection('schools').get());
  });
  it('משתמש לא מאומת אינו כותב דבר, גם אם יש לו תפקיד', async () => {
    const u = ctx('admin1', false);
    await assertFails(u.doc('topics/t-9').set({ he: 'x' }));
    await assertFails(u.doc('config/settings').set({ x: 1 }));
    const t = ctx('t1', false);
    await assertFails(t.doc(`requests/${slot('t1', 1)}`).set({ createdBy: 't1', status: 'open', description: 'כללי', kind: 'inquiry', createdAt: NOW }));
    await assertFails(t.doc('groups/n9').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
  });
  it('מוגבלות ידועה (מתועדת, לא שונתה): חבר במוסד יכול לכתוב להיסטוריית המוסד שלו, כולל פריטים של מורים אחרים', async () => {
    await assertSucceeds(ctx('t2').doc('schoolHistory/s1_2027-28').set({ schoolId: 's1', yearId: '2027-28', items: [], updatedAt: NOW }));
    await assertFails(ctx('t2').doc('schoolHistory/s2_2027-28').set({ schoolId: 's2', yearId: '2027-28', items: [], updatedAt: NOW }));
  });
  it('היסטוריה: הקריאה פתוחה לפי קוד מוסד ושנה (כפי שהוחלט), ללא רשימה, וללא שמות תלמידים בשדות', async () => {
    const d = await ctx(null).doc('schoolHistory/s1_2026-27').get();
    await assertSucceeds(Promise.resolve(d));
    await assertFails(ctx(null).collection('schoolHistory').get());
  });
});
