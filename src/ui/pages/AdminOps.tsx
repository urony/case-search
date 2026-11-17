import { useState } from 'react';
import type { BackupFile, RestoreMode } from '../../services/api';
import { Field, fmtDate, Notice, useAsync, useBusy } from '../components';
import { useRT } from '../ctx';

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

const COLL_LABEL: Record<string, string> = {
  topics: 'נושאים', topicVersions: 'גרסאות נושאים', config: 'הגדרות', public: 'קטלוג ציבורי', schools: 'מוסדות', schoolHistory: 'היסטוריית נושאים', policyQuestions: 'בירורים מקצועיים',
  sources: 'מקורות איתור', seedEntries: 'מיפוי מקור', deletionLedger: 'יומן מחיקות', suggestions: 'הצעות', groups: 'קבוצות', requests: 'בקשות', sourceReports: 'דיווחי מקורות',
  memberships: 'שיוך למוסד', roles: 'תפקידים', profiles: 'פרופילים',
};

export function BackupAdmin() {
  const { api } = useRT();
  const meta = useAsync(() => api.getBackupMeta(), [api]);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [file, setFile] = useState<{ name: string; json: BackupFile } | null>(null);
  const [mode, setMode] = useState<RestoreMode>('add_missing');
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.previewRestore>> | null>(null);
  const [safety, setSafety] = useState(false);
  const [confirm, setConfirm] = useState('');

  const doPreview = (b: BackupFile, m: RestoreMode) => run(() => api.previewRestore(b, m)).then(p => { if (p) setPlan(p); });
  return (
    <div className="stack">
      <h2>גיבוי ושחזור ידניים</h2>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>יצירת גיבוי</h3>
        {meta.data ? <p className="small">גיבוי אחרון: <b>{fmtDate(meta.data.lastBackupAt)}</b> ({meta.data.lastBackupPrivate ? 'כולל נתונים פרטיים' : 'תוכן בלבד'}).</p> : <p className="small"><b>עדיין לא בוצע גיבוי.</b></p>}
        <p className="small muted">הקובץ נשמר במחשב עם תאריך ושעה בשמו. <b>באחריות המנהל</b> להעביר אותו למקום מוגן (דרייב הפיקוח או דרייב ייעודי). אין שמירה אוטומטית.</p>
        <div className="grid2">
          <div><h4 style={{ margin: '0 0 4px' }}>נכלל בגיבוי תוכן</h4><p className="small">נושאים וכללים, גרסאות קודמות של נושאים, הגדרות, מוסדות, היסטוריית נושאים, מקורות איתור, בירורים מקצועיים, הצעות, מיפוי המקור ויומן המחיקות.</p></div>
          <div><h4 style={{ margin: '0 0 4px' }}>לא נכלל</h4><p className="small">חשבונות הכניסה עצמם (סיסמאות וכתובות ב־Firebase Authentication), יומן הפעולות, ופרטי הקשר של האחראי (בגיבוי תוכן). בגיבוי תוכן אין קבוצות, תלמידים, בקשות או פרופילים.</p></div>
        </div>
        <label className="row"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /> גיבוי פרטי: מוסיף קבוצות (כינויי תלמידים), בקשות, דיווחים, שיוך למוסד, תפקידים ופרופילים (שם וכתובת מייל)</label>
        {priv && <Notice kind="bad" title="אזהרה: ">קובץ זה כולל כינויי תלמידים, שמות וכתובות מייל. אין להעלות אותו ל־GitHub, לשלוח במייל או לשמור בתיקייה ציבורית. רק אם צריך לשמור את נתוני המחזור הנוכחי. בשחזור ממנו לא יחזרו קבוצות של מחזור שנסגר.</Notice>}
        <div className="row"><button className="btn" disabled={busy} onClick={() => run(async () => { download(`backup-${priv ? 'private' : 'content'}-${stamp()}.json`, await api.exportBackup(priv)); }).then(() => { setMsg('הגיבוי הורד לתיקיית ההורדות. יש להעביר אותו עכשיו למקום מוגן.'); setSafety(true); meta.reload(); })}>הורדת גיבוי</button></div>
        <details className="small"><summary>איך שומרים בדרייב</summary><ol className="tight"><li>אחרי ההורדה, מצאו את הקובץ בתיקיית ההורדות (שם הקובץ מתחיל ב־backup).</li><li>פתחו את תיקיית הגיבויים בדרייב, וגררו אליה את הקובץ. אם הוא כולל נתונים פרטיים, ודאו שהתיקייה אינה משותפת לציבור.</li><li>אחרי שהקובץ בדרייב, מחקו את העותק מתיקיית ההורדות.</li></ol></details>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>שחזור מגיבוי</h3>
        <p className="small muted">שחזור הוא פעולת מנהל בלבד. קודם מוצגת תצוגה מקדימה של מה ישתנה, ורק אחר כך כותבים. השחזור <b>אינו מוחק</b> מסמכים שנוצרו במערכת אחרי הגיבוי.</p>
        <input type="file" accept="application/json,.json" aria-label="קובץ גיבוי" onChange={async e => {
          const f = e.target.files?.[0]; setPlan(null); setMsg(null); setSafety(false); setConfirm('');
          if (f) { try { const json = JSON.parse(await f.text()); setFile({ name: f.name, json }); await doPreview(json, mode); } catch { setFile(null); setMsg('הקובץ אינו גיבוי תקין.'); } }
        }} />
        {file && (
          <>
            <fieldset className="stack"><legend>אופן השחזור</legend>
              <label className="row"><input type="radio" name="rmode" checked={mode === 'add_missing'} onChange={() => { setMode('add_missing'); setConfirm(''); doPreview(file.json, 'add_missing'); }} /> <span><b>הוספת מה שחסר בלבד (מומלץ).</b> מסמך שקיים במערכת נשאר כפי שהוא, גם אם הוא שונה מהגיבוי. מתאים כשחלק מהמידע נמחק.</span></label>
              <label className="row"><input type="radio" name="rmode" checked={mode === 'overwrite'} onChange={() => { setMode('overwrite'); setConfirm(''); doPreview(file.json, 'overwrite'); }} /> <span><b>החזרת מצב הגיבוי.</b> מסמכים שונים נדרסים בתוכן הגיבוי. גרסאות שמורות של נושאים, נושא שגרסתו במערכת חדשה יותר, והיסטוריה של מחזור שנסגר אינם נדרסים. מתאים אחרי תקלה.</span></label>
            </fieldset>
            {plan && (
              <div className="tablewrap"><table><thead><tr><th>אוסף</th><th>בגיבוי</th><th>יתווספו</th><th>זהים</th><th>יידרסו</th><th>יישארו כפי שהם במערכת</th><th>קיימים רק במערכת (לא יימחקו)</th></tr></thead>
                <tbody>{Object.entries(plan.report).filter(([, r]) => r.backup > 0 || r.liveOnly > 0).map(([k, r]) => <tr key={k}><td>{COLL_LABEL[k] ?? k}</td><td>{r.backup}</td><td>{r.add}</td><td>{r.same}</td><td>{r.overwrite}</td><td>{r.keptLive}{r.skippedClosed > 0 && ` (+${r.skippedClosed} של מחזור שנסגר, לא משוחזרים)`}</td><td>{r.liveOnly}</td></tr>)}</tbody></table></div>
            )}
            {plan && <p className="small">גיבוי מתאריך <b>{fmtDate(plan.createdAt)}</b> ({plan.includesPrivate ? 'כולל נתונים פרטיים' : 'תוכן בלבד'}). סך הכתיבות: <b>{plan.writes}</b>. מחזורים שנסגרו: {plan.closedYears.length ? plan.closedYears.join(', ') : 'אין'}.</p>}
            {mode === 'overwrite' && plan && plan.writes > 0 && (
              <Notice kind="warn" title="לפני דריסה: ">יש להוריד גיבוי של המצב הנוכחי, כדי שיהיה אפשר לחזור אחורה.
                <div className="row"><button className="btn small secondary" disabled={busy} onClick={() => run(async () => { download(`backup-before-restore-${stamp()}.json`, await api.exportBackup(false)); }).then(() => setSafety(true))}>הורדת גיבוי תוכן של המצב הנוכחי</button>{safety && <span className="badge ok">הורד</span>}</div>
              </Notice>
            )}
            {mode === 'overwrite' && plan && plan.writes > 0 && <Field label="להקלדת אישור כתבו: שחזור"><input type="text" value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>}
            <div className="row"><button className="btn danger" disabled={busy || !plan || plan.writes === 0 || (mode === 'overwrite' && (!safety || confirm !== 'שחזור'))}
              onClick={() => run(() => api.restoreBackup(file.json, { mode })).then(r => { if (r) { setMsg(`שוחזרו ${r.restored} מסמכים (${r.mode === 'add_missing' ? 'הוספת חסרים' : 'החזרת מצב הגיבוי'}). קבוצות של מחזור שנסגר שהוסרו מחדש: ${r.reDeleted}.`); setPlan(null); setFile(null); } })}>ביצוע השחזור</button>
              {plan && plan.writes === 0 && <span className="muted small">אין מה לשחזר: המערכת כבר כוללת את כל תוכן הגיבוי.</span>}</div>
          </>
        )}
        {msg && <Notice kind="info"><span role="status">{msg}</span></Notice>}{error && <p className="err" role="alert">{error}</p>}
        <details className="small"><summary>מה קורה למידע שנוסף או השתנה מאז הגיבוי</summary><ul className="tight">
          <li><b>נוסף אחרי הגיבוי:</b> נשאר. שחזור אינו מוחק דבר.</li>
          <li><b>שונה אחרי הגיבוי:</b> בהוספת חסרים נשאר כפי שהוא עכשיו. בהחזרת מצב הגיבוי נדרס, חוץ מנושא שגרסתו במערכת חדשה יותר.</li>
          <li><b>נמחק אחרי הגיבוי:</b> יחזור (בשני האופנים), חוץ מקבוצות של מחזור שנסגר.</li>
          <li><b>אם השחזור נקטע באמצע:</b> הכתיבה בקבוצות. מריצים שוב באותו אופן והוא משלים.</li>
          <li><b>חשבונות כניסה:</b> אינם בגיבוי. בשחזור מגיבוי פרטי לפרויקט חדש, המשתמשים צריכים להירשם מחדש והתפקידים יוצמדו לחשבונות לפי מזהה, ולכן יש להקצות מנהל ראשון מחדש.</li></ul></details>
        <p className="small muted">נבדק בנתוני ניסוי בלבד, בבדיקות האוטומטיות. לא נבדק על שירות Firebase אמיתי.</p>
      </div>
    </div>
  );
}
