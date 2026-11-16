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

const src = (uid: string) => ({ topicId: 't', title: 'עמותה מלאכותית', kind: 'association', text: 'טקסט', url: 'https://example.org', phone: '', region: '', population: '', createdBy: uid, createdAt: NOW, visible: true });

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
  it('מורה מאומת מוסיף; לא מאומת לא', async () => {
    await assertSucceeds(ctx('t1').doc('sources/new').set(src('t1')));
    await assertFails(ctx('t1', false).doc('sources/new2').set(src('t1')));
  });
  it('דוחה javascript: ושדה visible=false או createdBy של אחר', async () => {
    await assertFails(ctx('t1').doc('sources/a').set({ ...src('t1'), url: 'javascript:alert(1)' }));
    await assertFails(ctx('t1').doc('sources/b').set({ ...src('t1'), visible: false }));
    await assertFails(ctx('t1').doc('sources/c').set(src('t2')));
  });
  it('גם המוסיף אינו עורך, מסתיר או מוחק; מנהל כן', async () => {
    await assertFails(ctx('t1').doc('sources/s-vis').update({ title: 'חדש' }));
    await assertFails(ctx('t1').doc('sources/s-vis').update({ visible: false }));
    await assertFails(ctx('t1').doc('sources/s-vis').delete());
    await assertSucceeds(ctx('admin1').doc('sources/s-vis').update({ visible: false }));
  });
});

describe('T09 מורה אינו משנה תוכן', () => {
  it('נושא, כללים, תפקידים, הגדרות, התראות', async () => {
    const db = ctx('t1');
    await assertFails(db.doc('topics/t-1').set({ he: 'x' }));
    await assertFails(db.doc('config/general').set({ rules: {} }));
    await assertFails(db.doc('public/catalog_0').set({ topics: [] }));
    await assertFails(db.doc('roles/t1').set({ role: 'admin', grantedBy: 't1', grantedAt: 1 }));
    await assertFails(db.collection('notifications').get());
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
  it('בקשה: בעלים וקריאה למנהל בלבד; מורה משלים רק שדות מותרים', async () => {
    const r = { createdBy: 't1', status: 'open', description: 'כללי', kind: 'inquiry', createdAt: NOW };
    await assertSucceeds(ctx('t1').doc('requests/r1').set(r));
    await assertFails(ctx('t2').doc('requests/r1').get());
    await assertSucceeds(ctx('admin1').doc('requests/r1').get());
    await assertSucceeds(ctx('t1').doc('requests/r1').update({ supplement: 'עוד', status: 'open', updatedAt: NOW }));
    await assertFails(ctx('t1').doc('requests/r1').update({ adminReply: 'אישור' }));
    await assertFails(ctx('t1').doc('requests/r2').set({ ...r, adminReply: 'אישור עצמי' }));
  });
  it('פרופיל: רק עצמי, עם מייל מהטוקן', async () => {
    await assertSucceeds(ctx('t1').doc('profiles/t1').set({ uid: 't1', email: 't1@x.test', emailVerified: true, displayName: 'א' }));
    await assertFails(ctx('t1').doc('profiles/t1').set({ uid: 't1', email: 'other@x.test', emailVerified: true, displayName: 'א' }));
    await assertFails(ctx('t1').doc('profiles/t2').get());
  });
  it('התראה מורה: סוג מוכר בלבד', async () => {
    await assertSucceeds(ctx('t1').doc('notifications/n1').set({ type: 'source_added', refId: 'x', createdAt: NOW, readBy: [], summary: 'נוסף מקור' }));
    await assertFails(ctx('t1').doc('notifications/n2').set({ type: 'evil', refId: 'x', createdAt: NOW, readBy: [], summary: 'x' }));
  });
  it('גרסת נושא מפורסמת אינה נדרסת', async () => {
    await assertSucceeds(ctx('admin1').doc('topicVersions/t-1__v1').set({ he: 'x' }));
    await assertFails(ctx('admin1').doc('topicVersions/t-1__v1').update({ he: 'y' }));
    await assertFails(ctx('admin1').doc('topicVersions/t-1__v1').delete());
  });
});
