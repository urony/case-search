import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { academicYear } from '../../domain/years';
import type { Group, GroupStatus, RequestDoc } from '../../domain/types';
import { authErrorHe, DemoAuthService } from '../../services/auth';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../services/demoSeed';
import { Field, fmtDate, Loading, Notice, Tabs, useAsync, useBusy, ErrorBox } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';
import { isOverdue } from '../../domain/helpers';
import { startYearOf } from '../history';

// ───────── כניסה והרשמה ─────────
export function Login() {
  const { auth, mode, demo } = useRT();
  const { ctx, refresh } = useSession();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const { busy, error, run, setError } = useBusy();
  const next = sp.get('next') && sp.get('next')!.startsWith('/') ? sp.get('next')! : '/';

  if (mode === 'bundled') return (
    <div className="stack"><h2>כניסה</h2><Notice kind="warn" title="שירות הכניסה אינו מוגדר. ">האתר פועל כעת במצב קריאה בלבד, ללא חיבור לשירות נתונים. ראו את מדריך ההפעלה להגדרת Firebase.</Notice></div>
  );
  if (ctx.user) {
    return <div className="stack"><h2>כבר מחוברים</h2><p>מחוברים כ־<bdi>{ctx.user.email}</bdi>.</p><Link className="btn" to={next}>המשך</Link></div>;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setInfo(null);
    if (tab === 'in') {
      const r = await run(async () => { try { await auth.signIn(email, pw); return true; } catch (e) { throw new Error(authErrorHe(e)); } });
      if (r) { await refresh(); nav(next); }
    } else if (tab === 'up') {
      if (pw.length < 8) { setError('הסיסמה חייבת להכיל לפחות 8 תווים.'); return; }
      const r = await run(async () => { try { return await auth.signUp(email, pw, name || email.split('@')[0]); } catch (e) { throw new Error(authErrorHe(e)); } });
      if (r) {
        await refresh();
        setInfo(r.verificationSent ? 'נשלח מייל אימות. פתחו אותו ואשרו את הכתובת, ואז חזרו ולחצו "בדקתי".' : (r.error ?? 'ההרשמה בוצעה, אך מייל אימות לא נשלח.'));
      }
    } else {
      const r = await run(async () => { try { await auth.resetPassword(email); return true; } catch (e) { throw new Error(authErrorHe(e)); } });
      if (r) setInfo('אם הכתובת רשומה, נשלח אליה קישור לאיפוס סיסמה.');
    }
  }
  return (
    <div className="stack" style={{ maxInlineSize: 520, marginInline: 'auto' }}>
      <h2>כניסה או הרשמה</h2>
      <p className="muted">כניסה נדרשת לשמירת קבוצות, הוספת מקורות והגשת בקשות. אפשר להירשם עם כתובת מייל מכל ספק; הכתובת תאומת.</p>
      <Tabs tabs={[{ id: 'in', label: 'כניסה' }, { id: 'up', label: 'הרשמה' }, { id: 'reset', label: 'איפוס סיסמה' }]} value={tab} onChange={t => { setTab(t); setError(null); setInfo(null); }} />
      <form className="card stack" onSubmit={submit}>
        {tab === 'up' && <Field label="שם לתצוגה"><input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field>}
        <Field label="כתובת מייל"><input type="email" dir="ltr" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></Field>
        {tab !== 'reset' && <Field label="סיסמה" help={tab === 'up' ? 'לפחות 8 תווים' : undefined}><input type="password" dir="ltr" required value={pw} onChange={e => setPw(e.target.value)} autoComplete={tab === 'up' ? 'new-password' : 'current-password'} /></Field>}
        {error && <p className="err" role="alert">{error}</p>}
        {info && <Notice kind="info"><span role="status">{info}</span></Notice>}
        <button className="btn" disabled={busy}>{busy ? 'רגע…' : tab === 'in' ? 'כניסה' : tab === 'up' ? 'הרשמה' : 'שליחת קישור'}</button>
      </form>
      {mode === 'demo' && demo && (
        <Notice kind="warn" title="מצב הדגמה, חשבונות מלאכותיים: ">
          <div className="row">{DEMO_ACCOUNTS.map(a => <button key={a.uid} className="btn small secondary" onClick={async () => { await (demo as DemoAuthService).switchTo(a.uid); await refresh(); nav(next); }}>{a.displayName}</button>)}</div>
          <p className="small">סיסמת הדגמה לכולם: <code>{DEMO_PASSWORD}</code>. אין לכך קשר לחשבונות אמיתיים.</p>
        </Notice>
      )}
    </div>
  );
}

export function VerifyBanner() {
  const { auth } = useRT();
  const { ctx, refresh } = useSession();
  const [msg, setMsg] = useState<string | null>(null);
  if (!ctx.user || ctx.verified) return null;
  return (
    <Notice kind="warn" title="כתובת המייל טרם אומתה. ">
      עד האימות אפשר לעיין בלבד. <button className="btn small secondary" onClick={async () => { const r = await auth.resendVerification(); setMsg(r.sent ? 'נשלח שוב.' : (r.error ?? 'לא נשלח.')); }}>שליחת מייל אימות שוב</button>{' '}
      <button className="btn small" onClick={() => refresh().then(() => auth.refresh()).then(refresh)}>בדקתי, רענן</button> {msg && <span role="status">{msg}</span>}
    </Notice>
  );
}

// ───────── פרופיל ושיוך מוסדי ─────────
export function Profile() {
  const { api } = useRT();
  const { ctx } = useSession();
  const mem = useAsync(async () => (ctx.verified ? api.myMemberships() : []), [api, ctx.verified]);
  const [code, setCode] = useState('');
  const { busy, error, run } = useBusy();
  if (!ctx.user) return <Notice kind="warn">יש <Link to="/login?next=/profile">להיכנס</Link>.</Notice>;
  return (
    <div className="stack">
      <h2>פרופיל והקשר מוסדי</h2>
      <div className="card">
        <p>שם: {ctx.user.displayName || '—'}</p><p>מייל: <bdi className="ltr">{ctx.user.email}</bdi> {ctx.verified ? <span className="badge ok">מאומת</span> : <span className="badge warn">לא מאומת</span>}</p>
        <p>תפקיד: {ctx.role === 'admin' ? 'מנהל אתר' : ctx.role === 'coordinator' ? 'רכז מגמה' : 'מורה'}</p>
      </div>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>המוסדות שלי</h3>
        {mem.loading && <Loading />}
        {mem.data?.length === 0 && <p className="muted">לא משויכים למוסד. הזינו קוד מוסד כדי להצטרף.</p>}
        {mem.data?.map(m => <div key={m.id} className="row between"><span>{m.school?.name ?? m.schoolId} <span className="muted small">(קוד <bdi className="ltr">{m.schoolId}</bdi>)</span></span>
          <button className="btn small secondary" onClick={() => run(() => api.leaveSchool(m.id)).then(mem.reload)}>עזיבת מוסד</button></div>)}
        <form className="row" onSubmit={e => { e.preventDefault(); run(() => api.joinSchool(code)).then(r => { if (r) { setCode(''); mem.reload(); } }); }}>
          <input type="text" dir="ltr" value={code} onChange={e => setCode(e.target.value)} placeholder="קוד מוסד" aria-label="קוד מוסד" style={{ maxInlineSize: 200 }} autoComplete="off" />
          <button className="btn" disabled={busy || !ctx.verified}>הצטרפות בקוד</button>
        </form>
        <p className="small muted">הצטרפות בקוד מאפשרת ליצור קבוצות במוסד ולעיין בהיסטוריה. היא אינה מקנה גישה לקבוצות של מורים אחרים; הרשאת רכז ניתנת רק בידי הנהלת האתר.</p>
        {error && <p className="err" role="alert">{error}</p>}
      </div>
    </div>
  );
}

// ───────── הקבוצות שלי ─────────
const STATUS_LABEL: Record<GroupStatus, string> = {
  draft: 'טיוטה', self_check: 'בבדיקה עצמית', case_check_done: 'הושלמה בדיקת התאמה לפי המורה', needs_clarification: 'נדרש בירור',
  submitted_external: 'הוגש בטופס החיצוני (לפי דיווח)', done: 'בוצע (לפי דיווח)', cancelled: 'בוטל',
};

export function Groups() {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog, topicById } = useCatalog();
  const groups = useAsync(async () => (ctx.verified ? api.listMyGroups() : []), [api, ctx.verified]);
  const mem = useAsync(async () => (ctx.verified ? api.myMemberships() : []), [api, ctx.verified]);
  if (!ctx.user) return <Notice kind="warn">יש <Link to="/login?next=/groups">להיכנס</Link> כדי לנהל קבוצות.</Notice>;
  if (!ctx.verified) return <Notice kind="warn">יש לאמת את כתובת המייל.</Notice>;
  const year = catalog!.settings.currentYearId;
  const yearLabel = catalog!.years.find(y => y.id === year)?.label ?? academicYear(startYearOf(year)).label;
  return (
    <div className="stack">
      <h2>הקבוצות שלי</h2>
      <p className="muted">מחזור פעיל: {yearLabel}. נשמר מספר תלמידים בלבד; שם פרטי או כינוי הם רשות. הנתונים נמחקים בסיום המחזור ונשארת רק היסטוריית נושאים.</p>
      {groups.loading && <Loading />}
      {groups.error && <ErrorBox error={groups.error} retry={groups.reload} />}
      {groups.data?.length === 0 && <div className="card empty">עדיין אין קבוצות.</div>}
      {groups.data?.map((g, i) => <GroupCard key={g.id} g={g} n={i + 1} topicName={g.topicId ? topicById.get(g.topicId)?.he ?? g.topicId : null} onChange={groups.reload} />)}
      <NewGroup schools={mem.data ?? []} yearId={year} onDone={groups.reload} />
    </div>
  );
}

function NewGroup({ schools, yearId, onDone }: { schools: { schoolId: string; school: { name: string } | null }[]; yearId: string; onDone: () => void }) {
  const { api } = useRT();
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const [schoolId, setSchoolId] = useState(''); const [count, setCount] = useState(1); const [names, setNames] = useState(['', '', '']);
  const { busy, error, run } = useBusy();
  const [key, setKey] = useState(0);
  if (schools.length === 0) return <Notice kind="info">כדי ליצור קבוצה יש <Link to="/profile">להצטרף למוסד בקוד</Link>.</Notice>;
  return (
    <form key={key} className="card stack" onSubmit={e => { e.preventDefault(); run(() => api.createGroup({ schoolId: schoolId || schools[0].schoolId, yearId, studentCount: count, students: names.slice(0, count), clientId: `${clientId}-${key}` })).then(r => { if (r) { setNames(['', '', '']); setKey(k => k + 1); onDone(); } }); }}>
      <h3 style={{ margin: 0 }}>קבוצה חדשה</h3>
      <div className="grid cols2">
        <Field label="מוסד"><select value={schoolId || schools[0].schoolId} onChange={e => setSchoolId(e.target.value)}>{schools.map(s => <option key={s.schoolId} value={s.schoolId}>{s.school?.name ?? s.schoolId}</option>)}</select></Field>
        <Field label="מספר תלמידים בקבוצה (חובה)"><select value={count} onChange={e => setCount(Number(e.target.value))}><option value={1}>תלמיד אחד</option><option value={2}>שני תלמידים</option><option value={3}>שלושה תלמידים</option></select></Field>
      </div>
      <fieldset><legend>שם פרטי או כינוי לכל תלמיד (רשות)</legend>
        <div className="grid cols2">{Array.from({ length: count }, (_, i) => <input key={i} type="text" maxLength={30} aria-label={`תלמיד ${i + 1}`} placeholder={`תלמיד ${i + 1} (אפשר להשאיר ריק)`} value={names[i]} onChange={e => setNames(n => n.map((x, j) => (j === i ? e.target.value : x)))} autoComplete="off" />)}</div>
        <p className="help">אין להזין שמות משפחה, מספרי זהות, כתובות או טלפונים. השמות יימחקו בסיום המחזור.</p></fieldset>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? 'שומר…' : 'יצירת קבוצה'}</button>
    </form>
  );
}

function GroupCard({ g, n, topicName, onChange }: { g: Group; n: number; topicName: string | null; onChange: () => void }) {
  const { api } = useRT();
  const [edit, setEdit] = useState(false);
  const [count, setCount] = useState<number>(g.studentCount); const [names, setNames] = useState<string[]>([...g.students.map(s => s.label), '', '', ''].slice(0, 3));
  const { busy, error, run } = useBusy();
  const partial = g.topicId && g.casesDeclared < g.studentCount;
  return (
    <div className="card stack">
      <div className="row between">
        <b>קבוצה {n}: {g.studentCount === 1 ? 'תלמיד אחד' : `${g.studentCount} תלמידים`}</b>
        <span className="badge neutral">{STATUS_LABEL[g.status]}</span>
      </div>
      <div>נושא: {g.topicId ? <Link to={`/topic/${g.topicId}`}>{topicName}</Link> : <span className="muted">טרם נבחר. <Link to="/">חפשו נושא ושמרו אותו לקבוצה</Link></span>}</div>
      {g.students.length > 0 && <div className="small">תלמידים: {g.students.map(s => s.label).join(', ')}</div>}
      {g.topicId && <div>בדיקות מקרה שדווחו: <b>{g.casesDeclared} מתוך {g.studentCount}</b> {partial ? <span className="badge warn">התקדמות חלקית: אין עדיין שלמות קבוצתית</span> : <span className="badge ok">הושלם לפי דיווח המורה</span>}</div>}
      <div className="row">
        {g.topicId && <Link className="btn small secondary" to={`/topic/${g.topicId}?tab=check`}>בדיקת מקרה</Link>}
        <button className="btn small secondary" onClick={() => setEdit(e => !e)}>עריכת תלמידים</button>
        {g.status !== 'done' && g.status !== 'cancelled' && <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.setGroupStatus(g.id, 'submitted_external')).then(onChange)}>דיווח: הוגש בטופס החיצוני</button>}
        {g.status !== 'done' && g.status !== 'cancelled' && <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.setGroupStatus(g.id, 'done')).then(onChange)}>דיווח: בוצע</button>}
        {g.status !== 'cancelled' && g.status !== 'done' && <button className="btn small danger" disabled={busy} onClick={() => { if (confirm('לבטל את הקבוצה? הביטול נשמר כמעמד תפעולי ולא כעבודה שבוצעה.')) run(() => api.setGroupStatus(g.id, 'cancelled')).then(onChange); }}>ביטול קבוצה</button>}
      </div>
      {edit && (
        <form className="stack" onSubmit={e => { e.preventDefault(); run(() => api.updateStudents(g.id, count, names.slice(0, count))).then(r => { if (r) { setEdit(false); onChange(); } }); }}>
          <Field label="מספר תלמידים"><select value={count} onChange={e => setCount(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></Field>
          <div className="grid cols2">{Array.from({ length: count }, (_, i) => <input key={i} type="text" maxLength={30} aria-label={`תלמיד ${i + 1}`} value={names[i] ?? ''} onChange={e => setNames(a => a.map((x, j) => (j === i ? e.target.value : x)))} autoComplete="off" />)}</div>
          <p className="help">שינוי תלמידים אינו פותח בירור מקצועי מחדש, אך מספר המקרים הנדרש מתעדכן להרכב הנוכחי.</p>
          <button className="btn small" disabled={busy}>שמירה</button>
        </form>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

// ───────── בקשות ─────────
const KIND_LABEL: Record<string, string> = { new_topic: 'הצעת נושא חדש', inquiry: 'בירור כללי', exception_general: 'פנייה כללית לחריג' };
const STATUS_RQ: Record<string, string> = { open: 'פתוחה', waiting_teacher: 'ממתינה להשלמה מהמורה', answered: 'נענתה', closed: 'סגורה' };
const DECISION_LABEL: Record<string, string> = { supplement: 'בקשת השלמה', general_approval: 'אישור כללי', case_specific: 'החלטה נקודתית (אינה היתר כללי)', rejection: 'דחייה' };

export function RequestForm({ kind }: { kind: 'new_topic' | 'inquiry' }) {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog } = useCatalog();
  const [sp] = useSearchParams();
  const topicId = sp.get('topic') ?? undefined;
  const clientId = useMemo(() => crypto.randomUUID(), []);
  const [f, setF] = useState({ he: '', en: '', kind: '', system: '', description: '', rationale: '' });
  const [done, setDone] = useState<RequestDoc | null>(null);
  const { busy, error, run } = useBusy();
  if (!ctx.user) return <Notice kind="warn">יש <Link to={`/login?next=/requests/${kind === 'new_topic' ? 'new-topic' : 'inquiry'}`}>להיכנס</Link> כדי להגיש בקשה. תוכן כללי בלבד יישמר כשתחזרו.</Notice>;
  if (!ctx.verified) return <Notice kind="warn">יש לאמת את כתובת המייל.</Notice>;
  if (done) return <Notice kind="ok" title="הבקשה נשלחה. "><span role="status">היעד לטיפול: עד {fmtDate(done.dueAt)} (יעד בלבד, חלוף הזמן אינו אישור). מעקב: <Link to="/requests">הבקשות שלי</Link>.</span></Notice>;
  return (
    <form className="stack card" onSubmit={e => { e.preventDefault(); run(() => api.createRequest({ kind, topicId, proposedHe: f.he, proposedEn: f.en, proposedKind: f.kind, proposedSystem: f.system, description: f.description, rationale: f.rationale, clientId })).then(r => r && setDone(r)); }}>
      <h2 style={{ margin: 0 }}>{kind === 'new_topic' ? 'הצעת נושא חדש' : 'בירור כללי'}</h2>
      <Notice kind="warn" title="לא כותבים כאן פרטי מטופל. ">התיאור צריך להיות כללי בלבד: אין שם, גיל, פרטי קשר או תיאור מקרה רפואי. חריג לגבי מטופל מסוים מטופל בפנייה אישית לאחראי מחוץ לאתר.</Notice>
      {topicId && <p>בנושא: <b>{catalog?.topics.find(t => t.id === topicId)?.he ?? topicId}</b></p>}
      {kind === 'new_topic' && (
        <div className="grid cols2">
          <Field label="שם הנושא בעברית"><input type="text" value={f.he} onChange={e => setF({ ...f, he: e.target.value })} /></Field>
          <Field label="שם באנגלית (ככל שידוע)"><input type="text" dir="ltr" value={f.en} onChange={e => setF({ ...f, en: e.target.value })} /></Field>
          <Field label="סוג המצב"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="">לא ידוע</option><option>מחלה</option><option>מצב</option><option>אירוע</option><option>פגיעה</option><option>תסמונת</option></select></Field>
          <Field label="מערכת מוצעת"><select value={f.system} onChange={e => setF({ ...f, system: e.target.value })}><option value="">לא ידוע</option>{catalog?.systems.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
        </div>
      )}
      <Field label="תיאור כללי"><textarea required value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      {kind === 'new_topic' && <Field label="מדוע הנושא רלוונטי ומעניין לעבודת גמר?" help="אפשר לתאר טיפול, שיקום, מעקב והשוואה באופן כללי. אין חובה לבחור מטופלים לפני בקשה עקרונית."><textarea value={f.rationale} onChange={e => setF({ ...f, rationale: e.target.value })} /></Field>}
      {error && <p className="err" role="alert">{error} <span className="small">הטופס נשמר; אפשר לנסות שוב.</span></p>}
      <div><button className="btn" disabled={busy}>{busy ? 'שולח…' : 'שליחת בקשה'}</button></div>
    </form>
  );
}

export function MyRequests() {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog } = useCatalog();
  const rq = useAsync(async () => (ctx.verified ? api.listMyRequests() : []), [api, ctx.verified]);
  const [sup, setSup] = useState<Record<string, string>>({});
  const { busy, error, run } = useBusy();
  if (!ctx.user) return <Notice kind="warn">יש <Link to="/login?next=/requests">להיכנס</Link>.</Notice>;
  return (
    <div className="stack">
      <h2>הבקשות שלי</h2>
      <div className="row"><Link className="btn" to="/requests/new-topic">הצעת נושא חדש</Link><Link className="btn secondary" to="/requests/inquiry">בירור כללי</Link></div>
      {rq.loading && <Loading />}
      {rq.data?.length === 0 && <div className="card empty">אין בקשות.</div>}
      {rq.data?.map(r => (
        <div className="card stack" key={r.id}>
          <div className="row between"><b>{KIND_LABEL[r.kind]}{r.proposedHe ? `: ${r.proposedHe}` : ''}</b><span className="badge neutral">{STATUS_RQ[r.status]}</span></div>
          <div className="small muted">נשלחה {fmtDate(r.createdAt)} · יעד טיפול {fmtDate(r.dueAt)} {isOverdue(r, Date.now()) && <span className="badge warn">חרגה מהיעד, ההמתנה אינה אישור</span>}{r.topicId && <> · נושא: {catalog?.topics.find(t => t.id === r.topicId)?.he}</>}</div>
          <p>{r.description}</p>
          {r.adminReply && <Notice kind="info" title={`מענה${r.decisionKind ? ` (${DECISION_LABEL[r.decisionKind]})` : ''}: `}>{r.adminReply}</Notice>}
          {r.status === 'waiting_teacher' && (
            <form className="stack" onSubmit={e => { e.preventDefault(); run(() => api.supplementRequest(r.id, sup[r.id] ?? '')).then(rr => { if (rr !== undefined) { setSup({}); rq.reload(); } }); }}>
              <Field label="השלמת מידע כללי (ללא פרטי מקרה רפואי)"><textarea required value={sup[r.id] ?? ''} onChange={e => setSup({ ...sup, [r.id]: e.target.value })} /></Field>
              <div><button className="btn small" disabled={busy}>שליחת השלמה</button></div>
            </form>
          )}
        </div>
      ))}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}
