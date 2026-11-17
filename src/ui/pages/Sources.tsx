import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkSourceInput, safePhone, safeWebUrl, SOURCE_KINDS, SourceInput } from '../../domain/helpers';
import type { RecruitmentSource, SourceKind } from '../../domain/types';
import { Field, Loading, Notice, useAsync, useBusy, ErrorBox } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';

export function SourcesPanel({ topicId, topicHe }: { topicId: string; topicHe: string }) {
  const { api } = useRT();
  const { ctx } = useSession();
  const { reloadSources } = useCatalog();
  const { data, loading, error, reload } = useAsync(async () => (await api.listSources(topicId)).sort((a, b) => b.createdAt - a.createdAt), [api, topicId]);
  const [adding, setAdding] = useState(false);
  const [reported, setReported] = useState<string | null>(null);
  const rep = useBusy();

  return (
    <div className="stack">
      <Notice kind="info" title="מה זה? ">מקורות איתור הם פרטי קשר למקורות סיוע (עמותות, אתרים, קבוצות) שעשויים לעזור למצוא מטופלים. זו אינה רשימת אנשים עם מחלות, ואין להוסיף פרטי מטופל. מקור אינו משנה את תנאי ההתאמה.</Notice>
      {loading && <Loading />}
      {error && <ErrorBox error={error} retry={reload} />}
      {data && data.length === 0 && <div className="card empty">עדיין אין מקורות איתור לנושא זה.</div>}
      {data?.map(s => <SourceItem key={s.id} s={s} canReport={ctx.approved} onReport={async () => { const r = prompt('מה הבעיה במקור? (לדוגמה: לא מעודכן, לא רלוונטי)'); if (r) { await rep.run(() => api.reportSource(s.id, r)); setReported(s.id); } }} reported={reported === s.id} />)}
      {rep.error && <p className="err">{rep.error}</p>}
      {ctx.approved ? (
        adding
          ? <AddSourceForm topicId={topicId} topicHe={topicHe} onDone={() => { setAdding(false); reload(); reloadSources(); }} />
          : <button className="btn" onClick={() => setAdding(true)}>הוספת מקור איתור</button>
      ) : (
        <p>הוספת מקור ודיווח עליו זמינים למורים שהפיקוח אישר מראש. {ctx.user ? 'הכתובת שלכם טרם אושרה.' : <>יש <Link to={`/login?next=/topic/${topicId}`}>להיכנס</Link>.</>} מקור שמתווסף מתפרסם מיד.</p>
      )}
    </div>
  );
}

function SourceItem({ s, canReport, onReport, reported }: { s: RecruitmentSource; canReport: boolean; onReport: () => void; reported: boolean }) {
  const kind = SOURCE_KINDS.find(k => k.id === s.kind)?.label ?? s.kind;
  const url = safeWebUrl(s.url), phone = safePhone(s.phone);
  return (
    <div className="card">
      <div className="row between"><b>{s.title}</b><span className="badge neutral">{kind}</span></div>
      {/* טקסט חופשי מוצג כטקסט בלבד: React מקודד, ואין dangerouslySetInnerHTML */}
      {s.text && <p style={{ whiteSpace: 'pre-wrap' }}>{s.text}</p>}
      <div className="row small">
        {url && <a href={url} target="_blank" rel="noopener noreferrer nofollow">{new URL(url).hostname}</a>}
        {phone && <a href={`tel:${phone}`}><bdi className="ltr">{s.phone}</bdi></a>}
        {s.region && <span className="muted">אזור: {s.region}</span>}
        {s.population && <span className="muted">אוכלוסייה: {s.population}</span>}
      </div>
      {canReport && <div style={{ marginBlockStart: 8 }}>{reported ? <span role="status" className="small ok">הדיווח נשלח למנהל. המקור נשאר גלוי עד החלטה.</span> : <button className="linkbtn small" onClick={onReport}>דיווח על מקור</button>}</div>}
    </div>
  );
}

export function AddSourceForm({ topicId, topicHe, onDone }: { topicId: string; topicHe?: string; onDone: () => void }) {
  const { api } = useRT();
  const clientId = useMemo(() => crypto.randomUUID(), []); // מזהה יחיד לטופס: לחיצה כפולה אינה יוצרת כפילות
  const [f, setF] = useState<SourceInput>({ topicId, title: '', kind: 'association', text: '', url: '', phone: '', region: '', population: '', confirmNoPatientData: false });
  const { busy, error, run } = useBusy();
  const chk = checkSourceInput(f);
  const upd = (p: Partial<SourceInput>) => setF(s => ({ ...s, ...p }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api.addSource({ ...f, clientId }));
    if (r) onDone();
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h3 style={{ marginBlockStart: 0 }}>הוספת מקור איתור{topicHe ? ` לנושא: ${topicHe}` : ''}</h3>
      <Notice kind="warn" title="לפני ההוספה: ">אין להוסיף פרטי מטופל (שם, טלפון פרטי, מספר זהות, מייל או פרט רפואי). המקור יתפרסם מיד ויופיע בכרטיס הנושא. לאחר הפרסום רק מנהל יכול לערוך או להסיר אותו.</Notice>
      <Field label="כותרת ברורה"><input type="text" required maxLength={120} value={f.title} onChange={e => upd({ title: e.target.value })} /></Field>
      <Field label="סוג המקור"><select value={f.kind} onChange={e => upd({ kind: e.target.value as SourceKind })}>{SOURCE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
      <Field label="הסבר (טקסט חופשי, ללא HTML)" help={`${f.text.length}/1500`}><textarea maxLength={1500} value={f.text} onChange={e => upd({ text: e.target.value })} /></Field>
      <div className="grid cols2">
        <Field label="כתובת אתר (אופציונלי)" help="http או https בלבד"><input type="text" dir="ltr" inputMode="url" value={f.url} onChange={e => upd({ url: e.target.value })} /></Field>
        <Field label="טלפון של המקור (אופציונלי)"><input type="tel" dir="ltr" value={f.phone} onChange={e => upd({ phone: e.target.value })} /></Field>
        <Field label="אזור בארץ (אופציונלי)"><input type="text" maxLength={80} value={f.region} onChange={e => upd({ region: e.target.value })} /></Field>
        <Field label="אוכלוסייה מתאימה (אופציונלי)"><input type="text" maxLength={120} value={f.population} onChange={e => upd({ population: e.target.value })} /></Field>
      </div>
      <label className="row"><input type="checkbox" checked={f.confirmNoPatientData} onChange={e => upd({ confirmNoPatientData: e.target.checked })} /> אני מאשר/ת שלא הוספתי פרטי מטופל</label>
      {chk.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
      {f.title && !chk.ok && chk.errors.map(m => <p className="err small" key={m}>{m}</p>)}
      {error && <p className="err" role="alert">{error} <span className="small">התוכן שהוזן נשמר בטופס. אפשר לנסות שוב.</span></p>}
      <div className="row"><button className="btn" type="submit" disabled={busy || !chk.ok}>{busy ? 'שולח…' : 'פרסום המקור'}</button></div>
    </form>
  );
}
