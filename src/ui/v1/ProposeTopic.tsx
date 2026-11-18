import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Notice, useBusy } from '../components';
import { useRT } from '../ctx';

const COOLDOWN_KEY = 'mat-propose-last';
const COOLDOWN_MS = 60_000;

/**
 * הצעת נושא שאינו ברשימה, לבדיקה. פתוח לכל אחד בלי כניסה, אך נדרש שם, תפקיד ובית ספר כדי לאפשר סינון.
 * ההצעה נשלחת למנהל בלבד ואינה מתפרסמת. הגנות בדפדפן: שדה פיתיון והמתנה של דקה בין הצעות; ההגנה האמיתית היא סינון המנהל.
 */
export function ProposeTopic() {
  const { api, mode } = useRT();
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ name: '', details: '', who: '', role: '' as '' | 'teacher' | 'student' | 'other', school: '', contact: '', trap: '' });
  const { busy, error, run, setError } = useBusy();

  if (mode === 'bundled') return <div className="stack"><h2>הצעת נושא לבדיקה</h2><Notice kind="info">שליחת הצעות אינה זמינה בעותק זה של האתר.</Notice></div>;
  if (done) return (
    <div className="stack">
      <h2>הצעת נושא לבדיקה</h2>
      <Notice kind="ok"><span role="status">תודה! ההצעה נשלחה למנהל האתר. היא תיבדק, ואם הנושא יתאים הוא יתווסף לרשימה.</span></Notice>
      <div className="row"><Link className="btn secondary" to="/">חזרה לחיפוש</Link><button className="btn secondary" onClick={() => { setDone(false); setF({ ...f, name: '', details: '' }); }}>הצעת נושא נוסף</button></div>
    </div>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.trap) { setDone(true); return; }
    if (!f.role) { setError('נא לבחור תפקיד.'); return; }
    try {
      const last = Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
      if (Date.now() - last < COOLDOWN_MS) { setError('נשלחה הצעה לפני רגע. נסו שוב בעוד דקה.'); return; }
    } catch { /* אחסון חסום: ממשיכים */ }
    const r = await run(async () => { await api.submitTopicProposal({ name: f.name, details: f.details, who: f.who, role: f.role as 'teacher' | 'student' | 'other', school: f.school, contact: f.contact }); return true; });
    if (r) { try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ } setDone(true); }
  }

  return (
    <div className="stack">
      <h2>הצעת נושא לבדיקה</h2>
      <p className="muted">לא מצאתם מחלה או מצב רפואי ברשימה? אפשר להציע אותו כאן. ההצעה נשלחת למנהל האתר ונבדקת. אין בכך אישור של הנושא.</p>
      <form className="card stack" onSubmit={submit}>
        <Notice kind="warn"><b>אין לשלוח פרטי מטופל</b> (שם, טלפון, מספר זהות, מייל או פרט רפואי אישי). רק שם של מחלה או מצב רפואי.</Notice>
        <Field label="שם המחלה או המצב הרפואי"><input type="text" required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="הסבר או הערה (לא חובה)" help={`${f.details.length}/1000`}><textarea maxLength={1000} value={f.details} onChange={e => setF({ ...f, details: e.target.value })} /></Field>
        <fieldset className="stack" style={{ border: '1px solid #d5dbe3', borderRadius: 8, padding: 12 }}>
          <legend>מי מציע? (כדי שנוכל לסנן הצעות לא רציניות)</legend>
          <Field label="שם מלא"><input type="text" required maxLength={80} autoComplete="name" value={f.who} onChange={e => setF({ ...f, who: e.target.value })} /></Field>
          <Field label="תפקיד">
            <select required value={f.role} onChange={e => setF({ ...f, role: e.target.value as typeof f.role })}>
              <option value="">בחרו…</option><option value="teacher">מורה</option><option value="student">תלמיד או תלמידה</option><option value="other">אחר</option>
            </select>
          </Field>
          <Field label="בית ספר או מוסד" help="למשל: מורה בבית ספר פלוני בעיר פלונית"><input type="text" required maxLength={100} value={f.school} onChange={e => setF({ ...f, school: e.target.value })} /></Field>
          <Field label="איך אפשר לחזור אליכם (לא חובה)" help="לשימוש המנהל בלבד. אינו מתפרסם."><input type="text" maxLength={100} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} /></Field>
        </fieldset>
        <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: '-9999px' }}><label>אל תמלאו<input type="text" tabIndex={-1} autoComplete="off" value={f.trap} onChange={e => setF({ ...f, trap: e.target.value })} /></label></div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'שולח…' : 'שליחה למנהל'}</button><Link className="btn secondary" to="/">ביטול</Link></div>
      </form>
    </div>
  );
}
