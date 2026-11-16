// אתחול מנהל ראשון בצד השירות (סעיף 4.4). המשתמש חייב להירשם ולאמת את כתובתו באתר תחילה.
// שימוש:  node scripts/bootstrap-admin.mjs --email someone@example.com
// אין קידום אוטומטי לפי שם תצוגה או כתובת שהוקלדה בפרופיל; הכתובת נבדקת מול שירות ההתחברות.
import { init } from './_admin.mjs';

const email = process.argv[process.argv.indexOf('--email') + 1];
if (!email || email.startsWith('--')) { console.error('שימוש: node scripts/bootstrap-admin.mjs --email <כתובת>'); process.exit(1); }
const { db, auth } = init();
const user = await auth.getUserByEmail(email);
if (!user.emailVerified) { console.error('כתובת המייל של המשתמש טרם אומתה. יש לאמת תחילה.'); process.exit(1); }
await db.doc(`roles/${user.uid}`).set({ role: 'admin', grantedBy: 'bootstrap-script', grantedAt: Date.now() });
await db.doc(`profiles/${user.uid}`).set({ uid: user.uid, displayName: user.displayName ?? '', email: user.email, emailVerified: true, createdAt: Date.now() }, { merge: true });
console.log(`הוגדר מנהל: ${user.uid}`);
