// שליחת תור הדוא"ל דרך SMTP. ההודעות אינן כוללות מידע קליני או שמות תלמידים.
// דורש משתני סביבה: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, FIREBASE_PROJECT_ID + מפתח שירות.
// הסטטוס "sent" נקבע רק אחרי שהשרת קיבל את ההודעה; כשל נשמר כ"failed" לניסיון חוזר ואינו מאבד החלטה.
import nodemailer from 'nodemailer';
import { init } from './_admin.mjs';

for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) if (!process.env[k]) { console.error(`חסר ${k}: שליחה אמיתית לא הוגדרה.`); process.exit(2); }
const { db, auth } = init();
const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
const admins = (await db.collection('roles').where('role', '==', 'admin').get()).docs.map(d => d.id);
const adminMails = (await Promise.all(admins.map(async uid => (await auth.getUser(uid)).email))).filter(Boolean);
const pending = [...(await db.collection('outbox').where('status', '==', 'queued').get()).docs, ...(await db.collection('outbox').where('status', '==', 'failed').get()).docs];
let sent = 0, failed = 0;
for (const doc of pending) {
  const o = doc.data();
  try {
    const to = o.to === 'admins' ? adminMails : [(await auth.getUser(o.toUid)).email].filter(Boolean);
    if (!to.length) throw new Error('אין נמען');
    await tx.sendMail({ from: process.env.MAIL_FROM, to: to.join(','), subject: o.subject, text: o.body });
    await doc.ref.update({ status: 'sent', attempts: (o.attempts ?? 0) + 1 }); sent++;
  } catch (e) { await doc.ref.update({ status: 'failed', attempts: (o.attempts ?? 0) + 1 }); failed++; console.error(e.message); }
}
console.log(`נשלחו ${sent}, נכשלו ${failed}`);
