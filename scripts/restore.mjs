// שחזור מגיבוי, ואחריו הפעלה מחדש של מחיקות מחזור שהגיע מועדן (יומן deletionLedger).
// שימוש:  node scripts/restore.mjs backups/backup-....json
import fs from 'node:fs';
import { init } from './_admin.mjs';

const file = process.argv[2];
if (!file) { console.error('שימוש: node scripts/restore.mjs <קובץ גיבוי>'); process.exit(1); }
const b = JSON.parse(fs.readFileSync(file, 'utf8'));
if (b.format !== 'mat-backup-1') throw new Error('פורמט לא מוכר');
const { db } = init();
let n = 0;
for (const [coll, docs] of Object.entries(b.data)) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${coll}/${id}`).set(rest); n++; }
// מוחקים מחדש מה שכבר נמחק, לפני שהמערכת חוזרת לפעילות
const ledger = await db.collection('deletionLedger').get();
let del = 0;
for (const l of ledger.docs) for (const g of (await db.collection('groups').where('yearId', '==', l.id).get()).docs) { await g.ref.delete(); del++; }
console.log(`שוחזרו ${n} מסמכים; הופעלו מחדש מחיקות: ${del} קבוצות`);
