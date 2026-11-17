// גיבוי תוכן (פורמט זהה לגיבוי הידני באתר; השחזור נעשה באתר, בלשונית "גיבוי ושחזור", עם תצוגה מקדימה).
// משמש רק אם מחליטים על גיבוי אוטומטי (ראו docs/AUTO-BACKUP-PROPOSAL-he.md). אינו חלק מהתהליך הידני.
// גיבוי תוכן. כברירת מחדל: תוכן בלבד, בלי קבוצות, תלמידים, בקשות, פרופילים או כתובות מייל.
// שימוש:  node scripts/backup.mjs [--private] [--out backups]
// --private כולל כינויי תלמידים ופרטי משתמשים: לשמירה פרטית בלבד, לעולם לא ב-GitHub או במקום ציבורי.
import fs from 'node:fs';
import { init } from './_admin.mjs';

const priv = process.argv.includes('--private');
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'backups';
const PUBLIC = ['topics', 'topicVersions', 'config', 'public', 'schools', 'schoolHistory', 'policyQuestions', 'sources', 'seedEntries', 'deletionLedger', 'suggestions'];
const PRIVATE = ['groups', 'requests', 'sourceReports', 'memberships', 'roles', 'profiles'];
const { db } = init();
const data = {};
for (const c of priv ? [...PUBLIC, ...PRIVATE] : PUBLIC) {
  const snap = await db.collection(c).get();
  data[c] = snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => d.id !== 'backupMeta' && (priv || !(c === 'config' && d.id === 'contact')));
}
const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
const file = { format: 'mat-backup-2', createdAt: Date.now(), includesPrivate: priv, counts, data };
fs.mkdirSync(out, { recursive: true });
const name = `${out}/backup-${priv ? 'private' : 'content'}-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(name, JSON.stringify(file));
console.log(`נכתב ${name}: ${Object.entries(data).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);
