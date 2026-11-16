import { useState } from 'react';
import { Field, fmtDate, Loading, Notice, useAsync, useBusy } from '../components';
import { useRT } from '../ctx';

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function BackupAdmin() {
  const { api, mode } = useRT();
  const ob = useAsync(() => api.listOutbox(), [api]);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const [priv, setPriv] = useState(false);
  const [file, setFile] = useState<{ name: string; json: any } | null>(null);
  const stamp = () => new Date().toISOString().slice(0, 10);
  return (
    <div className="stack">
      <h2>גיבוי, דוא״ל והיסטוריית פעולות</h2>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>גיבוי ידני</h3>
        <p className="small muted">גיבוי תוכן כולל נושאים, גרסאות, כללים, מוסדות, היסטוריית נושאים ומקורות איתור. הוא אינו כולל קבוצות, תלמידים, בקשות או כתובות מייל. מומלץ לשמור אותו במקום פרטי. הגיבוי האוטומטי השבועי מתואר במדריך ההפעלה (קובץ GitHub Actions מוכן, שאינו מופעל).</p>
        <label className="row"><input type="checkbox" checked={priv} onChange={e => setPriv(e.target.checked)} /> כולל נתונים פרטיים (קבוצות, שמות או כינויי תלמידים, בקשות, פרופילים)</label>
        {priv && <Notice kind="bad" title="אזהרה: ">קובץ זה יכיל כינויי תלמידים ופרטי משתמשים. אין להעלות אותו ל־GitHub, לדוא״ל או לשום מקום ציבורי. בשחזור ממנו יופעל יומן המחיקות כדי שמחזורים שנסגרו לא יחזרו.</Notice>}
        <div className="row"><button className="btn" disabled={busy} onClick={() => run(async () => { download(`backup-${priv ? 'private' : 'content'}-${stamp()}.json`, await api.exportBackup(priv)); }).then(() => setMsg('הגיבוי הורד.'))}>הורדת גיבוי</button></div>
        <hr />
        <h3 style={{ margin: 0 }}>שחזור מגיבוי</h3>
        <input type="file" accept="application/json,.json" aria-label="קובץ גיבוי" onChange={async e => { const f = e.target.files?.[0]; if (f) { try { setFile({ name: f.name, json: JSON.parse(await f.text()) }); } catch { setFile(null); setMsg('הקובץ אינו JSON תקין.'); } } }} />
        {file && <div className="row"><span>{file.name}</span>
          <button className="btn danger" disabled={busy} onClick={() => { if (confirm('השחזור כותב את תוכן הגיבוי מעל הנתונים הקיימים. מחזורים שנסגרו יימחקו מחדש מיד לאחר השחזור. להמשיך?')) run(() => api.restoreBackup(file.json)).then(r => r && setMsg(`שוחזרו ${r.restored} מסמכים. מחיקות שהגיע מועדן הופעלו מחדש: ${r.reDeleted}.`)); }}>שחזור</button></div>}
        {msg && <Notice kind="info"><span role="status">{msg}</span></Notice>}{error && <p className="err" role="alert">{error}</p>}
        <p className="small muted">בדיקת שחזור נעשית בנתוני ניסוי בלבד, כפי שנבדק בבדיקות האוטומטיות של הפרויקט. לא הוכח שחזור על שירות Firebase אמיתי.</p>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>תור הודעות דוא״ל</h3>
        <Notice kind="warn" title="שליחה אמיתית טרם חוברה. ">הודעות נשמרות בתור, ללא מידע קליני או שמות תלמידים, וממתינות לשליחה. הרצת <code>scripts/send-outbox.mjs</code> עם פרטי שרת דוא״ל שיוגדרו בסביבה תשלח אותן; המערכת אינה מציגה "נשלח" כל עוד השליחה לא הצליחה בפועל. ההתראות באתר פועלות ללא קשר לדוא״ל.{mode === 'demo' && ' (מצב הדגמה: אין שליחה כלל.)'}</Notice>
        {ob.loading && <Loading />}
        <div className="tablewrap"><table><thead><tr><th>מועד</th><th>נמען</th><th>נושא ההודעה</th><th>מצב</th><th>ניסיונות</th><th></th></tr></thead><tbody>
          {(ob.data ?? []).slice(0, 40).map(o => (
            <tr key={o.id}><td>{fmtDate(o.createdAt)}</td><td>{o.to === 'admins' ? 'מנהלים' : 'מורה מגיש'}</td><td>{o.subject}</td>
              <td>{{ queued: 'בתור, טרם נשלחה', sent: 'נשלחה', failed: 'נכשלה', no_provider: 'אין ספק מוגדר' }[o.status]}</td><td>{o.attempts}</td>
              <td>{o.status === 'failed' && <button className="btn small secondary" onClick={() => api.retryOutbox(o.id).then(ob.reload)}>ניסיון חוזר</button>}</td></tr>))}</tbody></table></div>
      </div>
    </div>
  );
}

export { Field };
