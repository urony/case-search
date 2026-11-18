import { useState } from 'react';
import { Field, Notice, useBusy } from '../components';
import { useRT } from '../ctx';

const COOLDOWN_KEY = 'mat-suggest-last';
const COOLDOWN_MS = 30_000;

/**
 * הצעת מקור לאיתור מטופלים או המלצה, פתוחה לכל אחד, בלי כניסה.
 * ההצעה נשלחת למנהל בלבד ואינה מתפרסמת עד שמנהל מאשר אותה.
 * הגנות בסיסיות: שדה פיתיון נגד רובוטים והמתנה של 30 שניות בין הצעות (בדפדפן). ההגנה האמיתית היא אישור המנהל.
 */
export function SuggestForm({ topicId, topicHe }: { topicId: string; topicHe: string }) {
  const { api, mode } = useRT();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ title: '', text: '', url: '', contact: '', trap: '' });
  const { busy, error, run, setError } = useBusy();

  if (mode === 'bundled') return <p className="small muted">שליחת הצעות אינה זמינה בעותק זה של האתר.</p>;
  if (done) return <Notice kind="ok"><span role="status">תודה! ההצעה נשלחה למנהל האתר. היא תתפרסם רק אם תאושר.</span> <button className="linkbtn small" onClick={() => { setDone(false); setOpen(false); }}>סגירה</button></Notice>;
  if (!open) return <div><button type="button" className="btn secondary small" onClick={() => setOpen(true)}>הצעת מקור או המלצה לנושא זה</button></div>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.trap) { setDone(true); return; } // רובוט: מדמים הצלחה ואינם שולחים
    try {
      const last = Number(localStorage.getItem(COOLDOWN_KEY) ?? 0);
      if (Date.now() - last < COOLDOWN_MS) { setError('נשלחה הצעה לפני רגע. נסו שוב בעוד חצי דקה.'); return; }
    } catch { /* אחסון חסום: ממשיכים */ }
    const r = await run(async () => { await api.submitSuggestion({ topicId, title: f.title, text: f.text, url: f.url, contact: f.contact }); return true; });
    if (r) { try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch { /* ignore */ } setDone(true); }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h4 style={{ margin: 0 }}>הצעת מקור או המלצה: {topicHe}</h4>
      <Notice kind="warn">אפשר להציע עמותה, אתר, קבוצה או דרך לאיתור מטופלים, או המלצה אחרת לנושא. <b>אין לשלוח פרטי מטופל</b> (שם, טלפון פרטי, מספר זהות, מייל או פרט רפואי). ההצעה נשלחת למנהל ותתפרסם רק אם תאושר.</Notice>
      <Field label="כותרת קצרה"><input type="text" required maxLength={120} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="מה מציעים? (לפחות 10 תווים)" help={`${f.text.length}/1000`}><textarea required maxLength={1000} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} /></Field>
      <Field label="כתובת אתר (לא חובה)" help="http או https בלבד"><input type="text" dir="ltr" inputMode="url" maxLength={500} value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>
      <Field label="איך אפשר לחזור אליכם (לא חובה)" help="לשימוש המנהל בלבד, אם יהיו שאלות. אינו מתפרסם."><input type="text" maxLength={100} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} /></Field>
      {/* שדה פיתיון: מוסתר מבני אדם */}
      <div aria-hidden="true" style={{ position: 'absolute', insetInlineStart: '-9999px' }}><label>אל תמלאו<input type="text" tabIndex={-1} autoComplete="off" value={f.trap} onChange={e => setF({ ...f, trap: e.target.value })} /></label></div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy ? 'שולח…' : 'שליחה למנהל'}</button><button type="button" className="btn secondary" onClick={() => setOpen(false)}>ביטול</button></div>
    </form>
  );
}
