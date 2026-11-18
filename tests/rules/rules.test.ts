// בדיקות לכללי ההרשאות (firestore.rules) מול אמולטור Firestore: אורח, מורה מאושר, מורה שטרם אושר, מורה שהגישה שלו בוטלה, רכז ומנהל.
// כוללות גישה ישירה למסד (עוקפת את כפתורי האתר). דורשות Java ו-firebase-tools:  npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const NOW = 1_800_000_000_000;

// כתובת המייל בטוקן: <uid>@x.test (הרשימה המאושרת מכוונת לפי זה)
const ctx = (uid: string | null, verified = true, emailOverride?: string) =>
  uid ? env.authenticatedContext(uid, { email_verified: verified, email: emailOverride ?? `${uid}@x.test` }).firestore() : env.unauthenticatedContext().firestore();
const allow = (uid: string, schoolIds: string[], active = true) => ({ id: `${uid}@x.test`, email: `${uid}@x.test`, name: uid, schoolIds, active, addedBy: 'admin1', addedAt: NOW });

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
    // t1, t2: מאושרים למוסד s1. t3: נרשם ומאומת אך אינו ברשימה. t4: אושר ואז הגישה בוטלה. t5: מאושר למוסד s2.
    await db.doc('allowedTeachers/t1@x.test').set(allow('t1', ['s1']));
    await db.doc('allowedTeachers/t2@x.test').set(allow('t2', ['s1']));
    await db.doc('allowedTeachers/t4@x.test').set({ ...allow('t4', ['s1'], false), revokedAt: NOW });
    await db.doc('allowedTeachers/t5@x.test').set(allow('t5', ['s2']));
    await db.doc('groups/g1').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [{ label: 'כינוי' }], status: 'draft' });
    await db.doc('groups/g4').set({ ownerUid: 't4', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [{ label: 'כינוי' }], status: 'draft' });
    await db.doc('public/catalogMeta').set({ chunks: 1 });
    await db.doc('topics/t-1').set({ he: 'טיוטה', publish: 'draft' });
    await db.doc('sources/s-vis').set({ topicId: 't', title: 'מקור גלוי', visible: true, createdBy: 't1' });
    await db.doc('sources/s-hid').set({ topicId: 't', title: 'מקור מוסתר', visible: false, createdBy: 't1' });
    await db.doc('config/contact').set({ email: 'owner@x.test' });
    await db.doc('schoolHistory/s1_2026-27').set({ schoolId: 's1', yearId: '2026-27', items: [{ groupId: 'x', topicId: 't', topicHe: 'נושא', state: 'done' }] });
  });
});

const src = (uid: string) => ({ topicId: 't', title: 'עמותה מלאכותית', kind: 'association', text: 'טקסט', url: 'https://example.org', phone: '', region: '', population: '', createdBy: uid, createdAt: NOW, visible: true, reviewed: false });
const DAY = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const slot = (uid: string, n: number, day = DAY) => `${uid}_${day}_${n}`;
const rq = (uid: string) => ({ createdBy: uid, createdByEmail: `${uid}@x.test`, status: 'open', description: 'כללי', kind: 'inquiry', createdAt: NOW });

describe('אורח: קריאה ציבורית בלבד', () => {
  it('קורא קטלוג ומקורות גלויים; לא מוסתרים, טיוטות, אחראי או מוסדות', async () => {
    const db = ctx(null);
    await assertSucceeds(db.doc('public/catalogMeta').get());
    await assertSucceeds(db.doc('sources/s-vis').get());
    await assertSucceeds(db.collection('sources').where('visible', '==', true).get());
    await assertFails(db.doc('sources/s-hid').get());
    await assertFails(db.doc('topics/t-1').get());
    await assertFails(db.doc('config/contact').get());
    await assertFails(db.doc('schools/s1').get());
    await assertFails(db.collection('schools').get());
  });
  it('אינו כותב דבר: מקור, בקשה, דיווח, קבוצה, פרופיל של אחר', async () => {
    const db = ctx(null);
    await assertFails(db.doc(`sources/${slot('t1', 1)}`).set(src('t1')));
    await assertFails(db.doc(`requests/${slot('t1', 1)}`).set(rq('t1')));
    await assertFails(db.doc('sourceReports/t1_s-vis').set({ sourceId: 's-vis', reason: 'x', createdBy: 't1', createdAt: NOW, handled: false }));
    await assertFails(db.doc('groups/n1').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
    await assertFails(db.doc('allowedTeachers/guest@x.test').set(allow('guest', [])));
  });
  it('אינו קורא קבוצות, תלמידים, בקשות, או היסטוריית מוסד (get ישיר או שאילתה)', async () => {
    const db = ctx(null);
    await assertFails(db.doc('groups/g1').get());
    await assertFails(db.collection('groups').get());
    await assertFails(db.doc('schoolHistory/s1_2026-27').get());   // השתנה: ההיסטוריה אינה פתוחה לאורחים
    await assertFails(db.collection('schoolHistory').get());
    await assertFails(db.doc('allowedTeachers/t1@x.test').get());
    await assertFails(db.collection('allowedTeachers').get());
  });
});

describe('משתמש מאומת שאינו ברשימה (t3): עיון בלבד', () => {
  it('אינו כותב, וקורא רק מה שפתוח לאורחים', async () => {
    const db = ctx('t3');
    await assertFails(db.doc(`sources/${slot('t3', 1)}`).set(src('t3')));
    await assertFails(db.doc(`requests/${slot('t3', 1)}`).set(rq('t3')));
    await assertFails(db.doc('groups/n1').set({ ownerUid: 't3', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
    await assertFails(db.doc('schoolHistory/s1_2026-27').get());
    await assertFails(db.doc('config/contact').get());
    await assertFails(db.doc('schools/s1').get());
    await assertFails(db.collection('groups').where('ownerUid', '==', 't3').get());
    await assertSucceeds(db.doc('public/catalogMeta').get());
    await assertSucceeds(db.doc('sources/s-vis').get());
  });
  it('אינו מאשר את עצמו ואינו קורא את הרשימה; מותר לו פרופיל משלו בלבד', async () => {
    const db = ctx('t3');
    await assertFails(db.doc('allowedTeachers/t3@x.test').set(allow('t3', ['s1'])));
    await assertFails(db.doc('allowedTeachers/t1@x.test').get());
    await assertFails(db.collection('allowedTeachers').get());
    await assertSucceeds(db.doc('profiles/t3').set({ uid: 't3', email: 't3@x.test', emailVerified: true, displayName: 'א', createdAt: NOW }));
  });
  it('לא מאומת (email_verified=false), גם אם הכתובת ברשימה, אינו מאושר', async () => {
    const db = ctx('t1', false);
    await assertFails(db.doc(`sources/${slot('t1', 1)}`).set(src('t1')));
    await assertFails(db.doc('schoolHistory/s1_2026-27').get());
    await assertFails(db.doc('groups/g1').get());
    await assertFails(db.doc('allowedTeachers/t1@x.test').get());
  });
  it('כתובת בטוקן שאינה הכתובת ברשימה אינה מאושרת (אי אפשר להתחזות בהקלדה)', async () => {
    const db = ctx('t3', true, 't1@x.test.evil.com');
    await assertFails(db.doc(`sources/${slot('t3', 1)}`).set(src('t3')));
    await assertFails(db.doc('allowedTeachers/t1@x.test').get());
  });
  it('אותיות גדולות בכתובת הטוקן עדיין מותאמות לרשימה (נרמול)', async () => {
    const db = ctx('t1', true, 'T1@X.TEST');
    await assertSucceeds(db.doc(`sources/${slot('t1', 1)}`).set(src('t1')));
  });
});

describe('מורה שהגישה שלו בוטלה (t4): נחסם מיד', () => {
  it('אינו כותב, אינו קורא קבוצות והיסטוריה, גם של עצמו', async () => {
    const db = ctx('t4');
    await assertFails(db.doc(`sources/${slot('t4', 1)}`).set(src('t4')));
    await assertFails(db.doc(`requests/${slot('t4', 1)}`).set(rq('t4')));
    await assertFails(db.doc('groups/g4').get());
    await assertFails(db.collection('groups').where('ownerUid', '==', 't4').get());
    await assertFails(db.doc('groups/g4').update({ status: 'done' }));
    await assertFails(db.doc('schoolHistory/s1_2026-27').get());
  });
  it('ביטול והחזרה בידי המנהל חלים מיד', async () => {
    await assertSucceeds(ctx('t1').doc(`sources/${slot('t1', 1)}`).set(src('t1')));
    await assertSucceeds(ctx('admin1').doc('allowedTeachers/t1@x.test').update({ active: false, revokedAt: NOW }));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 2)}`).set(src('t1')));
    await assertFails(ctx('t1').doc('groups/g1').get());
    await assertSucceeds(ctx('admin1').doc('allowedTeachers/t1@x.test').update({ active: true }));
    await assertSucceeds(ctx('t1').doc('groups/g1').get());
  });
});

describe('מורה מאושר (t1): מקורות', () => {
  it('מוסיף במזהה יומי תקין; לא מאומת לא', async () => {
    await assertSucceeds(ctx('t1').doc(`sources/${slot('t1', 1)}`).set(src('t1')));
    await assertFails(ctx('t1', false).doc(`sources/${slot('t1', 2)}`).set(src('t1')));
  });
  it('מכסה יומית נאכפת בשירות: עד 5, מזהה של אחר או תאריך אחר נדחים, ומזהה חופשי נדחה', async () => {
    for (let n = 1; n <= 5; n++) await assertSucceeds(ctx('t1').doc(`sources/${slot('t1', n)}`).set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 6)}`).set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 0)}`).set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1, '20200101')}`).set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t2', 1)}`).set(src('t1')));
    await assertFails(ctx('t1').doc('sources/new').set(src('t1')));
    await assertFails(ctx('t1').doc(`sources/${slot('t1', 1)}`).set({ ...src('t1'), title: 'דריסה של מקור קיים' }));
  });
  it('דוחה javascript:, visible=false, reviewed=true, createdBy של אחר, ושדות לא מוכרים (כולל מייל או שם)', async () => {
    const id = `sources/${slot('t1', 1)}`;
    await assertFails(ctx('t1').doc(id).set({ ...src('t1'), url: 'javascript:alert(1)' }));
    await assertFails(ctx('t1').doc(id).set({ ...src('t1'), visible: false }));
    await assertFails(ctx('t1').doc(id).set({ ...src('t1'), reviewed: true }));
    await assertFails(ctx('t1').doc(id).set(src('t2')));
    await assertFails(ctx('t1').doc(id).set({ ...src('t1'), isAdmin: true }));
    await assertFails(ctx('t1').doc(id).set({ ...src('t1'), createdByEmail: 't1@x.test' })); // המקורות ציבוריים: אין בהם מייל
  });
  it('גם המוסיף אינו עורך, מסתיר או מוחק; מנהל כן', async () => {
    await assertFails(ctx('t1').doc('sources/s-vis').update({ title: 'חדש' }));
    await assertFails(ctx('t1').doc('sources/s-vis').update({ reviewed: true }));
    await assertFails(ctx('t1').doc('sources/s-vis').delete());
    await assertSucceeds(ctx('admin1').doc('sources/s-vis').update({ reviewed: true }));
    await assertSucceeds(ctx('admin1').doc('sources/s-vis').update({ visible: false }));
  });
});

describe('דיווחי מקורות', () => {
  const rep1 = (uid: string, sid = 's-vis') => ({ sourceId: sid, reason: 'לא מעודכן', createdBy: uid, createdAt: NOW, handled: false });
  it('דיווח אחד לכל משתמש ומקור, בשמו; לא עדכון; מנהל רואה ומטפל; אחר אינו קורא', async () => {
    await assertSucceeds(ctx('t2').doc('sourceReports/t2_s-vis').set(rep1('t2')));
    await assertFails(ctx('t2').doc('sourceReports/t1_s-vis').set(rep1('t2')));
    await assertFails(ctx('t2').doc('sourceReports/t2_s-hid').set({ ...rep1('t2'), handled: true }));
    await assertFails(ctx('t1').doc('sourceReports/t2_s-vis').get());
    await assertFails(ctx('t2').doc('sourceReports/t2_s-vis').update({ handled: true }));
    await assertSucceeds(ctx('admin1').doc('sourceReports/t2_s-vis').update({ handled: true }));
    await assertFails(ctx('t1').collection('sourceReports').get());
    await assertSucceeds(ctx('admin1').collection('sourceReports').get());
  });
  it('מי שאינו מאושר אינו מדווח', async () => {
    await assertFails(ctx('t3').doc('sourceReports/t3_s-vis').set(rep1('t3')));
    await assertFails(ctx('t4').doc('sourceReports/t4_s-vis').set(rep1('t4')));
  });
});

describe('T09 מורה אינו משנה תוכן', () => {
  it('נושא, כללים, תפקידים, הגדרות, רשימת מאושרים, התראות או תור דוא"ל', async () => {
    const db = ctx('t1');
    await assertFails(db.doc('topics/t-1').set({ he: 'x' }));
    await assertFails(db.doc('config/general').set({ rules: {} }));
    await assertFails(db.doc('public/catalog_0').set({ topics: [] }));
    await assertFails(db.doc('roles/t1').set({ role: 'admin', grantedBy: 't1', grantedAt: 1 }));
    await assertFails(db.doc('allowedTeachers/t1@x.test').update({ schoolIds: ['s1', 's2'] }));
    await assertFails(db.doc('notifications/n1').set({ type: 'new_request', refId: 'x', createdAt: NOW, readBy: [], summary: 'x' }));
    await assertFails(db.doc('outbox/o1').set({ to: 'admins', status: 'queued', subject: 'x', body: 'x', attempts: 0, createdAt: NOW }));
  });
  it('מנהל כן, כולל ניהול הרשימה', async () => {
    const db = ctx('admin1');
    await assertSucceeds(db.doc('topics/t-1').set({ he: 'x' }));
    await assertSucceeds(db.doc('config/general').set({ rules: {} }));
    await assertSucceeds(db.doc('allowedTeachers/new@x.test').set(allow('new', ['s1'])));
    await assertSucceeds(db.collection('allowedTeachers').get());
  });
  it('מנהל לא מאומת אינו מנהל', async () => { await assertFails(ctx('admin1', false).doc('topics/t-1').get()); });
  it('מורה מאושר קורא רק את מסמך האישור של כתובתו', async () => {
    await assertSucceeds(ctx('t1').doc('allowedTeachers/t1@x.test').get());
    await assertFails(ctx('t1').doc('allowedTeachers/t2@x.test').get());
    await assertFails(ctx('t1').collection('allowedTeachers').get());
  });
});

describe('קבוצות והיסטוריה (לפי אישור המוסד)', () => {
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
  it('יצירת קבוצה: מורה מאושר, במוסד שאושר לו, 1–3 תלמידים, ובעלות עצמית', async () => {
    const ok = { ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 2, students: [], status: 'draft' };
    await assertSucceeds(ctx('t1').doc('groups/n1').set(ok));
    await assertFails(ctx('t1').doc('groups/n2').set({ ...ok, studentCount: 4 }));
    await assertFails(ctx('t1').doc('groups/n3').set({ ...ok, schoolId: 's2' }));     // מוסד שלא אושר לו
    await assertFails(ctx('t1').doc('groups/n4').set({ ...ok, ownerUid: 't2' }));
    await assertFails(ctx('t1').doc('groups/n5').set({ ...ok, studentCount: 1, students: [{ label: 'a' }, { label: 'b' }] }));
    await assertFails(ctx('t3').doc('groups/n6').set({ ...ok, ownerUid: 't3' }));     // לא ברשימה
    await assertFails(ctx('t1').doc('groups/n7').set({ ...ok, schoolId: 's2' }));
  });
  it('לא ניתן ליצור קבוצה במחזור שנסגר', async () => {
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc('deletionLedger/2027-28').set({ yearId: '2027-28' }); });
    await assertFails(ctx('t1').doc('groups/n8').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
  });
  it('אי אפשר ליצור שיוך או חברות עצמית: אין עוד אוסף חברויות, וקוד מוסד אינו מקנה דבר', async () => {
    await assertFails(ctx('t3').doc('memberships/t3_s1').set({ uid: 't3', schoolId: 's1', startedAt: NOW, endedAt: null }));
    await assertFails(ctx('t3').doc('roles/t3').set({ role: 'coordinator', schoolId: 's1', grantedBy: 't3', grantedAt: 1 }));
    await assertFails(ctx('t3').doc('schoolHistory/s1_2026-27').get());
  });
  it('היסטוריה: מורה מאושר למוסד קורא את מוסדו בלבד; מורה ממוסד אחר, רכז ממוסד אחר ומי שלא ברשימה לא', async () => {
    await assertSucceeds(ctx('t1').doc('schoolHistory/s1_2026-27').get());
    await assertSucceeds(ctx('t2').doc('schoolHistory/s1_2026-27').get());
    await assertSucceeds(ctx('coord1').doc('schoolHistory/s1_2026-27').get());
    await assertSucceeds(ctx('admin1').doc('schoolHistory/s1_2026-27').get());
    await assertFails(ctx('t5').doc('schoolHistory/s1_2026-27').get());   // מאושר, אבל למוסד אחר
    await assertFails(ctx('t3').doc('schoolHistory/s1_2026-27').get());
    await assertFails(ctx(null).doc('schoolHistory/s1_2026-27').get());
    await assertFails(ctx('t1').collection('schoolHistory').get());        // אין רשימה
    await assertSucceeds(ctx('admin1').collection('schoolHistory').get());
  });
  it('היסטוריה: כתיבה לחבר מאושר או רכז של המוסד בלבד', async () => {
    const h = { schoolId: 's1', yearId: '2027-28', items: [], updatedAt: NOW };
    await assertSucceeds(ctx('t1').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t3').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t5').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t4').doc('schoolHistory/s1_2027-28').set(h));
    await assertFails(ctx('t1').doc('schoolHistory/s1_wrong').set(h));
  });
});

describe('בקשות ופרופילים', () => {
  it('בקשה: מורה מאושר, מזהה יומי; קריאה לבעלים ולמנהל בלבד; השלמה רק בשדות מותרים', async () => {
    await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', 1)}`).set(rq('t1')));
    await assertFails(ctx('t1').doc('requests/free-id').set(rq('t1')));
    await assertFails(ctx('t3').doc(`requests/${slot('t3', 1)}`).set(rq('t3')));
    await assertFails(ctx('t2').doc(`requests/${slot('t1', 1)}`).get());
    await assertSucceeds(ctx('admin1').doc(`requests/${slot('t1', 1)}`).get());
    await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ supplement: 'עוד', status: 'open', updatedAt: NOW }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ adminReply: 'אישור' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 1)}`).update({ status: 'answered', decisionKind: 'general_approval' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 2)}`).set({ ...rq('t1'), adminReply: 'אישור עצמי' }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 3)}`).set({ ...rq('t1'), repliedAt: NOW }));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 4)}`).set({ ...rq('t1'), createdByEmail: 'other@x.test' })); // מי הגיש: לא ניתן לזייף
  });
  it('מכסת בקשות: עד 10 ביום', async () => {
    for (let n = 1; n <= 10; n++) await assertSucceeds(ctx('t1').doc(`requests/${slot('t1', n)}`).set(rq('t1')));
    await assertFails(ctx('t1').doc(`requests/${slot('t1', 11)}`).set(rq('t1')));
  });
  it('חיווי "חדש": הבעלים מסמן ראיתי; אחר לא; ולא ביחד עם שינוי אחר', async () => {
    const id = slot('t1', 1);
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc(`requests/${id}`).set({ ...rq('t1'), status: 'answered', adminReply: 'מענה', repliedAt: NOW, teacherSeenAt: 0 }); });
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
  it('פרטי הקשר של האחראי: מורה מאושר בלבד (לא אורח, לא מי שטרם אושר)', async () => {
    await assertSucceeds(ctx('t1').doc('config/contact').get());
    await assertFails(ctx('t3').doc('config/contact').get());
    await assertFails(ctx(null).doc('config/contact').get());
    await assertSucceeds(ctx('t1').doc('schools/s1').get());
    await assertFails(ctx('t3').doc('schools/s1').get());
  });
});

describe('גישה ישירה למסד (עוקפת את כפתורי האתר)', () => {
  it('מורה אינו קורא נתוני מורה אחר: פרופיל, בקשות, קבוצות', async () => {
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore();
      await db.doc('profiles/t1').set({ uid: 't1', email: 't1@x.test', emailVerified: true, displayName: 'מורה אחד' });
      await db.doc(`requests/${slot('t1', 1)}`).set(rq('t1'));
    });
    const t2 = ctx('t2');
    await assertFails(t2.doc('profiles/t1').get());
    await assertFails(t2.doc(`requests/${slot('t1', 1)}`).get());
    await assertFails(t2.doc('groups/g1').get());
  });
  it('שאילתות רחבות נדחות לכל מי שאינו מנהל', async () => {
    for (const who of ['t1', 't3', 'coord1', null]) {
      const db = ctx(who);
      for (const c of ['groups', 'requests', 'profiles', 'roles', 'schools', 'schoolHistory', 'topics', 'audit', 'suggestions', 'seedEntries', 'deletionLedger', 'policyQuestions', 'sourceReports', 'allowedTeachers', 'sources']) {
        if (c === 'schools' && who === 'coord1') continue; // רכז רשאי לרשום מוסדות
        await assertFails(db.collection(c).get());
      }
    }
    // שאילתות מצומצמות מותרות רק למי שמורשה
    await assertSucceeds(ctx('t1').collection('groups').where('ownerUid', '==', 't1').get());
    await assertSucceeds(ctx('t1').collection('requests').where('createdBy', '==', 't1').get());
    await assertFails(ctx('t3').collection('groups').where('ownerUid', '==', 't3').get());
    await assertFails(ctx('t4').collection('groups').where('ownerUid', '==', 't4').get());
    await assertSucceeds(ctx(null).collection('sources').where('visible', '==', true).get());
  });
  it('אוספי ניהול סגורים בפני מורה, רכז, מי שלא אושר ואורח', async () => {
    for (const who of ['t1', 't3', 'coord1', null]) {
      const db = ctx(who);
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
  it('העלאת הרשאות: אי אפשר לתת לעצמי תפקיד או אישור, למחוק תפקיד, או להרחיב מוסדות', async () => {
    await assertFails(ctx('t1').doc('roles/t1').set({ role: 'admin', grantedBy: 't1', grantedAt: 1 }));
    await assertFails(ctx('t1').doc('roles/admin1').delete());
    await assertFails(ctx('t1').doc('allowedTeachers/t1@x.test').update({ schoolIds: ['s1', 's2'] }));
    await assertFails(ctx('t1').doc('allowedTeachers/t2@x.test').delete());
    await assertFails(ctx('coord1').doc('roles/coord1').set({ role: 'admin', grantedBy: 'x', grantedAt: 1 }));
    await assertFails(ctx('coord1').doc('allowedTeachers/t9@x.test').set(allow('t9', ['s1'])));
  });
  it('רכז: קבוצות מוסדו בלבד, ואינו כותב תוכן', async () => {
    await assertSucceeds(ctx('coord1').collection('groups').where('schoolId', '==', 's1').get());
    await assertFails(ctx('coord1').collection('groups').where('schoolId', '==', 's2').get());
    await assertFails(ctx('coord1').doc('topics/t-1').set({ he: 'x' }));
    await assertFails(ctx('coord1').doc('sources/s-vis').update({ visible: false }));
    await assertSucceeds(ctx('coord1').collection('schools').get());
  });
  it('משתמש לא מאומת אינו כותב דבר, גם אם יש לו תפקיד או אישור', async () => {
    const u = ctx('admin1', false);
    await assertFails(u.doc('topics/t-9').set({ he: 'x' }));
    await assertFails(u.doc('config/settings').set({ x: 1 }));
    await assertFails(u.doc('allowedTeachers/x@x.test').set(allow('x', [])));
    const t = ctx('t1', false);
    await assertFails(t.doc(`requests/${slot('t1', 1)}`).set(rq('t1')));
    await assertFails(t.doc('groups/n9').set({ ownerUid: 't1', schoolId: 's1', yearId: '2027-28', studentCount: 1, students: [] }));
  });
  it('מוגבלות ידועה (מתועדת, לא שונתה): מורה מאושר במוסד יכול לכתוב להיסטוריית המוסד שלו, כולל פריטים של עמיתים; לא של מוסד אחר', async () => {
    await assertSucceeds(ctx('t2').doc('schoolHistory/s1_2027-28').set({ schoolId: 's1', yearId: '2027-28', items: [], updatedAt: NOW }));
    await assertFails(ctx('t2').doc('schoolHistory/s2_2027-28').set({ schoolId: 's2', yearId: '2027-28', items: [], updatedAt: NOW }));
  });
});

describe('גרסה ראשונה: ניהול התוכן הציבורי (מנהל בלבד)', () => {
  const adminSrc = { topicId: 't', title: 'מקור שהוזן בידי מנהל', kind: 'association', text: 'טקסט', url: 'https://example.org', phone: '', region: '', population: '', createdBy: 'admin1', createdAt: NOW, visible: true, reviewed: true };
  const newItem = { yearId: '2027-28', topicId: null, title: 'כותרת', text: 'טקסט', publishedAt: NOW, visible: true, createdBy: 'admin1', updatedAt: NOW };

  it('הציבור קורא את העותק הציבורי כולו (מסמך ראשי, נושאים, מקורות, מה נוסף)', async () => {
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc('public/sources_0').set({ sources: [] }); });
    const db = ctx(null);
    await assertSucceeds(db.doc('public/catalogMeta').get());
    await assertSucceeds(db.doc('public/sources_0').get());
  });
  for (const who of [null, 't1', 't3', 't4', 'coord1'] as const) {
    it(`${who ?? 'אורח'} אינו כותב לעותק הציבורי ואינו מוחק אותו`, async () => {
      const db = ctx(who);
      await assertFails(db.doc('public/catalogMeta').set({ chunks: 1, generatedAt: 1 }));
      await assertFails(db.doc('public/catalog_0').set({ topics: [] }));
      await assertFails(db.doc('public/sources_0').set({ sources: [] }));
      await assertFails(db.doc('public/catalogMeta').delete());
    });
    it(`${who ?? 'אורח'} אינו קורא או כותב את "מה נוסף השנה" במאגר הראשי`, async () => {
      const db = ctx(who);
      await assertFails(db.doc('newItems/n1').get());
      await assertFails(db.collection('newItems').get());
      await assertFails(db.doc('newItems/n1').set(newItem));
    });
    it(`${who ?? 'אורח'} אינו מוסיף מקור בדרך של מנהל (מזהה חופשי)`, async () => {
      await assertFails(ctx(who).doc('sources/s-free').set(adminSrc));
    });
  }
  it('מנהל מאומת כותב ומוחק פריטים ומפרסם עותק ציבורי', async () => {
    const db = ctx('admin1');
    await assertSucceeds(db.doc('newItems/n1').set(newItem));
    await assertSucceeds(db.collection('newItems').get());
    await assertSucceeds(db.doc('public/catalogMeta').set({ chunks: 1, generatedAt: 2 }));
    await assertSucceeds(db.doc('public/sources_0').set({ sources: [] }));
    await assertSucceeds(db.doc('sources/s-free').set(adminSrc));
    await assertSucceeds(db.doc('newItems/n1').delete());
  });
  it('מנהל שהמייל שלו לא אומת אינו כותב דבר', async () => {
    const db = ctx('admin1', false);
    await assertFails(db.doc('public/catalogMeta').set({ chunks: 1 }));
    await assertFails(db.doc('newItems/n1').set(newItem));
    await assertFails(db.doc('sources/s-free').set(adminSrc));
  });
});

describe('הצעות מהציבור: אורח יוצר בלבד, מנהל קורא ומטפל', () => {
  const sug = { topicId: 't-1', title: 'כותרת הצעה', text: 'טקסט הצעה באורך תקין', url: '', contact: '', status: 'open', createdAt: NOW };
  for (const who of [null, 't1', 't3'] as const) {
    it(`${who ?? 'אורח'} יוצר הצעה תקינה אך אינו קורא, מעדכן או מוחק`, async () => {
      const db = ctx(who);
      await assertSucceeds(db.doc('publicSuggestions/p-1').set(sug));
      await assertFails(db.doc('publicSuggestions/p-1').get());
      await assertFails(db.collection('publicSuggestions').get());
      await assertFails(db.doc('publicSuggestions/p-1').update({ status: 'approved' }));
      await assertFails(db.doc('publicSuggestions/p-1').delete());
    });
  }
  it('דוחה הצעה לא תקינה: שדה נוסף, סטטוס מאושר, טקסט קצר או ארוך, קישור מסוכן, כותרת קצרה', async () => {
    const db = ctx(null);
    await assertFails(db.doc('publicSuggestions/p-2').set({ ...sug, extra: 1 }));
    await assertFails(db.doc('publicSuggestions/p-3').set({ ...sug, status: 'approved' }));
    await assertFails(db.doc('publicSuggestions/p-4').set({ ...sug, text: 'קצר' }));
    await assertFails(db.doc('publicSuggestions/p-5').set({ ...sug, text: 'א'.repeat(1001) }));
    await assertFails(db.doc('publicSuggestions/p-6').set({ ...sug, url: 'javascript:alert(1)' }));
    await assertFails(db.doc('publicSuggestions/p-7').set({ ...sug, title: 'א' }));
    await assertFails(db.doc('publicSuggestions/p-8').set({ ...sug, contact: 'א'.repeat(101) }));
  });
  it('מנהל קורא ומסמן; מנהל לא מאומת אינו', async () => {
    await env.withSecurityRulesDisabled(async c => { await c.firestore().doc('publicSuggestions/p-9').set(sug); });
    await assertSucceeds(ctx('admin1').doc('publicSuggestions/p-9').get());
    await assertSucceeds(ctx('admin1').collection('publicSuggestions').get());
    await assertSucceeds(ctx('admin1').doc('publicSuggestions/p-9').update({ status: 'approved' }));
    await assertFails(ctx('admin1', false).doc('publicSuggestions/p-9').get());
  });
});
