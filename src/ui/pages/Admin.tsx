import { useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ConflictError } from '../../services/store';
import { validateRuleSet } from '../../engine/validate';
import { DEFAULT_GENERAL_RULES } from '../../engine/general';
import type { RuleSet } from '../../engine/types';
import { GROUP_STATUS_LABEL, isOverdue, REQUEST_KIND_LABEL, REQUEST_STATUS_LABEL, requestStateLabel } from '../../domain/helpers';
import { academicYear } from '../../domain/years';
import type { Kind, Note, PolicyQuestion, RequestDoc, Role, Settings, Topic } from '../../domain/types';
import { Field, fmtDate, Loading, Notice, Tabs, useAsync, useBusy, ErrorBox, PolicyBadge, POLICY_LABEL } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';
import { startYearOf } from '../history';
import CaseCheck from './CaseCheck';
import { TopicCard } from './Home';
import RuleSetEditor from './RuleEditor';
import { BackupAdmin } from './AdminOps';

export default function Admin() {
  const { ctx } = useSession();
  const { mode } = useRT();
  if (!ctx.user) return <Notice kind="warn">אזור הניהול דורש <Link to="/login?next=/admin">כניסה</Link>.</Notice>;
  if (ctx.role !== 'admin') return <Notice kind="bad" title="אין הרשאה. ">אזור זה מיועד למנהלי האתר. ההרשאה נאכפת גם בצד השירות.</Notice>;
  const { badges } = useSession();
  const cnt = (to: string): number => ({ '/admin/requests': badges.admin?.openRequests ?? 0, '/admin/sources': (badges.admin?.unreviewedSources ?? 0) + (badges.admin?.openReports ?? 0), '/admin/suggestions': badges.admin?.openSuggestions ?? 0 } as Record<string, number>)[to] ?? 0;
  const links: [string, string][] = [['/admin', 'תמונת מצב'], ['/admin/topics', 'מחלות וכללים'], ['/admin/requests', 'בקשות והחלטות'], ['/admin/sources', 'מקורות איתור'], ['/admin/suggestions', 'הצעות'], ['/admin/schools', 'מוסדות'], ['/admin/cycles', 'מחזורים'], ['/admin/users', 'משתמשים והרשאות'], ['/admin/questions', 'בירורים מקצועיים'], ['/admin/rules', 'כללי סף כלליים'], ['/admin/settings', 'הגדרות'], ['/admin/backup', 'גיבוי ושחזור']];
  return (
    <div className="admin">
      <nav aria-label="ניווט ניהול">{links.map(([to, l]) => <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => (isActive ? 'active' : '')}>{l}{cnt(to) > 0 && <span className="count">{cnt(to)}</span>}</NavLink>)}</nav>
      <div className="stack" style={{ minInlineSize: 0 }}>
        {mode === 'demo' && <Notice kind="warn">מצב הדגמה: כל הנתונים מלאכותיים ושמורים בדפדפן זה בלבד.</Notice>}
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="topics" element={<TopicsAdmin />} />
          <Route path="topics/:id" element={<TopicEditor />} />
          <Route path="requests" element={<RequestsAdmin />} />
          <Route path="sources" element={<SourcesAdmin />} />
          <Route path="suggestions" element={<SuggestionsAdmin />} />
          <Route path="schools" element={<SchoolsAdmin />} />
          <Route path="cycles" element={<CyclesAdmin />} />
          <Route path="users" element={<UsersAdmin />} />
          <Route path="questions" element={<QuestionsAdmin />} />
          <Route path="rules" element={<GeneralRulesAdmin />} />
          <Route path="settings" element={<SettingsAdmin />} />
          <Route path="backup" element={<BackupAdmin />} />
        </Routes>
      </div>
    </div>
  );
}

// ───────── תמונת מצב ─────────
function Dashboard() {
  const { api } = useRT();
  const { badges, refreshBadges } = useSession();
  const d = useAsync(async () => {
    const [b, open, prog, src, rep, bk] = await Promise.all([
      api.adminBadges(), api.adminListRequests(['open']), api.adminListRequests(['in_progress']), api.adminListSources(true), api.adminListSourceReports(true), api.getBackupMeta(),
    ]);
    return { b, open, prog, src, rep, bk };
  }, [api]);
  const { catalog } = useCatalog();
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <ErrorBox error={d.error ?? ''} retry={d.reload} />;
  const { b, open, prog, src, rep, bk } = d.data;
  const now = Date.now();
  const overdue = [...open, ...prog].filter(x => isOverdue(x, now)).length;
  const topicsNotFull = (catalog?.topics ?? []).filter(x => x.coverage.level !== 'full' && x.publish === 'published').length;
  const backupAgeDays = bk ? Math.floor((now - bk.lastBackupAt) / 86_400_000) : null;
  void badges; void refreshBadges;
  return (
    <div className="stack">
      <h2>תמונת מצב</h2>
      <p className="muted small">המערכת אינה שולחת דוא״ל. עדכונים מופיעים כאן וליד "ניהול" בתפריט כשנכנסים לאתר. הספירות נטענות בכניסה ובמעבר בין דפים, לכל היותר פעם בדקה.</p>
      <div className="kpi">
        <Link className="card" to="/admin/requests"><b>{b.openRequests}</b>בקשות חדשות הממתינות לטיפול{overdue > 0 && <span className="badge warn"> {overdue} חרגו מהיעד</span>}</Link>
        <Link className="card" to="/admin/requests"><b>{b.inProgress}</b>בקשות בטיפול</Link>
        <Link className="card" to="/admin/sources"><b>{b.unreviewedSources}</b>מקורות חדשים שטרם נבדקו</Link>
        <Link className="card" to="/admin/sources"><b>{b.openReports}</b>דיווחים על מקורות</Link>
        <Link className="card" to="/admin/suggestions"><b>{b.openSuggestions}</b>הצעות הממתינות להכרעה</Link>
        <div className="card"><b>{topicsNotFull}</b>נושאים שכיסוי הכללים בהם אינו מלא</div>
      </div>
      {backupAgeDays === null && <Notice kind="warn" title="גיבוי: ">עדיין לא בוצע גיבוי ידני. מומלץ לבצע אחד בלשונית "גיבוי ושחזור" ולשמור אותו בדרייב.</Notice>}
      {backupAgeDays !== null && backupAgeDays > 30 && <Notice kind="warn" title="גיבוי: ">הגיבוי הידני האחרון בוצע לפני {backupAgeDays} ימים ({fmtDate(bk!.lastBackupAt)}).</Notice>}
      {backupAgeDays !== null && backupAgeDays <= 30 && <p className="muted small">גיבוי ידני אחרון: {fmtDate(bk!.lastBackupAt)}.</p>}
      <h3>דורש פעולה</h3>
      {b.total === 0 && b.inProgress === 0 && <p className="muted">אין פריטים הממתינים לטיפול.</p>}
      <ul className="plain stack">
        {[...open, ...prog].slice(0, 8).map(x => <li className="card" key={x.id}><Link to="/admin/requests">{x.proposedHe || x.description.slice(0, 60)}</Link> <span className="muted small">· {fmtDate(x.createdAt)}</span> <span className="badge neutral">{REQUEST_STATUS_LABEL[x.status]}</span>{isOverdue(x, now) && <span className="badge warn">חרגה מהיעד</span>}</li>)}
        {src.slice(0, 6).map(x => <li className="card" key={x.id}>מקור חדש: <Link to="/admin/sources">{x.title}</Link> <span className="muted small">· {fmtDate(x.createdAt)}</span></li>)}
        {rep.slice(0, 6).map(x => <li className="card" key={x.id}>דיווח על מקור: {x.reason} <Link to="/admin/sources">לטיפול</Link></li>)}
      </ul>
    </div>
  );
}

// ───────── רשימת נושאים וייבוא ─────────
function TopicsAdmin() {
  const { api } = useRT();
  const { catalog, reload } = useCatalog();
  const nav = useNavigate();
  const topics = useAsync(() => api.adminListTopics(), [api]);
  const [q, setQ] = useState(''); const [flt, setFlt] = useState('');
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.previewSeedImport>> | null>(null);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const list = (topics.data ?? []).filter(t => (!q || t.he.includes(q) || t.en.toLowerCase().includes(q.toLowerCase())) && (!flt || (flt === 'review' ? t.coverage.level !== 'full' : flt === 'unclassified' ? t.kind === 'unclassified' : flt === 'sys' ? t.systemsNeedReview : flt === 'draft' ? t.publish !== 'published' : true))).sort((a, b) => a.he.localeCompare(b.he, 'he'));
  return (
    <div className="stack">
      <div className="row between"><h2>מחלות וכללים</h2><Link className="btn" to="/admin/topics/new">נושא חדש</Link></div>
      <div className="card stack">
        <b>ייבוא מיפוי המקורות (114 רשומות)</b>
        <p className="small muted">הייבוא חוזר־בטוח לפי seedId: רשומה חדשה יוצרת נושא; שינוי במקור יוצר הצעת עדכון ואינו דורס עריכות מנהל.</p>
        <div className="row">
          <button className="btn secondary small" disabled={busy} onClick={() => run(() => api.previewSeedImport()).then(p => p && setPlan(p))}>תצוגה מקדימה</button>
          {plan && <button className="btn small" disabled={busy} onClick={async () => { const r = await run(async () => { const p = await api.applySeedImport(); await api.publishCatalog(); return p; }); if (r) { setMsg(`יובאו ${r.createTopics.length} נושאים חדשים, ${r.suggestions.length} הצעות עדכון, ${r.skipped.length} ללא שינוי.`); setPlan(null); topics.reload(); reload(); } }}>אישור הייבוא ופרסום הקטלוג</button>}
        </div>
        {plan && <p>צפוי: {plan.createTopics.length} נושאים חדשים · {plan.suggestions.length} הצעות עדכון · {plan.skipped.length} ללא שינוי.</p>}
        {msg && <Notice kind="ok"><span role="status">{msg}</span></Notice>}
        {error && <p className="err">{error}</p>}
      </div>
      <div className="row">
        <input type="search" placeholder="סינון לפי שם" aria-label="סינון לפי שם" value={q} onChange={e => setQ(e.target.value)} style={{ maxInlineSize: 280 }} />
        <select aria-label="תצוגה" value={flt} onChange={e => setFlt(e.target.value)} style={{ inlineSize: 'auto' }}><option value="">הכול</option><option value="review">כיסוי כללים אינו מלא</option><option value="unclassified">טרם סווגו (סוג רשומה)</option><option value="sys">שיוך מערכת לבדיקה</option><option value="draft">טיוטה או לא מפורסם</option></select>
        <span className="muted small">{list.length} נושאים</span>
      </div>
      {topics.loading && <Loading />}
      {topics.error && <ErrorBox error={topics.error} retry={topics.reload} />}
      <div className="tablewrap"><table>
        <thead><tr><th>נושא</th><th>מעמד</th><th>פרסום</th><th>כיסוי</th><th>סוג</th><th></th></tr></thead>
        <tbody>{list.map(t => (
          <tr key={t.id}><td>{t.he}<span className="en">{t.en}</span></td><td><PolicyBadge policy={t.policy} /></td>
            <td>{{ draft: 'טיוטה', published: 'פורסם', unpublished: 'הוסר', merged: 'מוזג' }[t.publish]}</td>
            <td>{{ full: 'מלא', partial: 'חלקי', none: 'חסר' }[t.coverage.level]}</td><td>{t.kind === 'unclassified' ? (t.kindSuggestion ? `טרם סווג (הצעה: ${KIND_LABEL[t.kindSuggestion]})` : 'טרם סווג') : KIND_LABEL[t.kind]}</td>
            <td><button className="btn small secondary" onClick={() => nav(`/admin/topics/${t.id}`)}>עריכה</button></td></tr>))}</tbody>
      </table></div>
      <span className="sr-only">{catalog?.topics.length}</span>
    </div>
  );
}

const KIND_LABEL: Record<Kind, string> = { unclassified: 'טרם סווג', disease: 'מחלה', condition: 'מצב', event: 'אירוע', injury: 'פגיעה', syndrome: 'תסמונת', category: 'קטגוריה', redirect: 'הפניה לאבחנה' };

// ───────── עורך נושא ─────────
function blankTopic(): Topic {
  return {
    id: `t-${crypto.randomUUID().slice(0, 8)}`, seedIds: [], he: '', en: '', aliases: [], kind: 'disease', systems: [], systemsRaw: [], systemsNeedReview: false,
    tags: [], suggestedTags: [], policy: 'needs_review', publish: 'draft', ageMin: null, ageMax: null, difficulty: 0, notes: [], sourceCondition: '', reviewNote: '',
    sourcePages: '', mappingStatusRaw: '', familyId: '', relations: [], rules: { questions: [], rules: [] }, coverage: { level: 'none', reason: 'נושא חדש: טרם הוגדרו כללים' },
    generalThreshold: true, addedYear: null, sourceMapped: false, version: 0, updatedAt: 0, updatedBy: '',
  };
}

type ETab = 'details' | 'class' | 'rules' | 'notes' | 'preview' | 'history';

function TopicEditor() {
  const { id } = useParams();
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog, reload } = useCatalog();
  const nav = useNavigate();
  const loaded = useAsync(async () => (id === 'new' ? blankTopic() : api.adminGetTopic(id!)), [api, id]);
  const pq = useAsync(() => api.listPolicyQuestions(), [api]);
  const all = useAsync(() => api.adminListTopics(), [api]);
  const [t, setT] = useState<Topic | null>(null);
  const [baseVersion, setBase] = useState(0);
  const [tab, setTab] = useState<ETab>('details');
  const { busy, error, run, setError } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  if (loaded.data && !t) { setT(loaded.data); setBase(loaded.data.version); }
  if (loaded.loading || !catalog) return <Loading />;
  if (loaded.error) return <ErrorBox error={loaded.error} />;
  if (!t) return <Notice kind="bad">הנושא לא נמצא.</Notice>;
  const upd = (p: Partial<Topic>) => { setT({ ...t, ...p }); setMsg(null); };
  const issues = validateRuleSet(t.rules, t.coverage, { ageMin: t.ageMin, ageMax: t.ageMax });
  const errors = issues.filter(i => i.level === 'error');

  async function save(publishNow: boolean) {
    const next: Topic = { ...t!, publish: publishNow ? 'published' : t!.publish };
    let groups = 0;
    if (publishNow || next.publish === 'published') groups = (await run(() => api.adminActiveGroupsForTopic(next.id))) ?? 0;
    if (publishNow && !confirm(`סיכום השפעה:\n· הכרטיס יפורסם בקטלוג הציבורי כפי שנראה בלשונית "תצוגה מקדימה".\n· השינוי חל קדימה בלבד: בדיקות חדשות ישתמשו בכללים החדשים; החלטות קודמות אינן נפתחות מחדש.\n· קבוצות פעילות בנושא: ${groups}.\nלפרסם?`)) return;
    const saved = await run(async () => {
      const s = await api.saveTopic(next, baseVersion);
      if (s.publish === 'published' || t!.publish === 'published' || publishNow) { await api.publishCatalog(); reload(); }
      return s;
    });
    if (saved) { setT(saved); setBase(saved.version); setMsg(`נשמר כגרסה ${saved.version}${saved.publish === 'published' ? ' ופורסם בקטלוג' : ''}.`); if (id === 'new') nav(`/admin/topics/${saved.id}`, { replace: true }); }
  }
  const conflict = error?.includes('שונתה בידי משתמש אחר');
  return (
    <div className="stack">
      <p className="small"><Link to="/admin/topics">← לרשימת הנושאים</Link></p>
      <div className="row between"><h2>{t.he || 'נושא חדש'}</h2><span className="muted small">גרסה {t.version}{t.sourceMapped ? ' · מיפוי ראשוני' : ''}</span></div>
      <Tabs<ETab> tabs={[{ id: 'details', label: 'פרטים ושמות' }, { id: 'class', label: 'סיווג' }, { id: 'rules', label: `תנאים${errors.length ? ` (${errors.length} שגיאות)` : ''}` }, { id: 'notes', label: 'הערות ואיתור' }, { id: 'preview', label: 'תצוגה מקדימה' }, { id: 'history', label: 'היסטוריה' }]} value={tab} onChange={setTab} />

      {tab === 'details' && (
        <div className="card stack">
          <div className="grid cols2">
            <Field label="שם עברי"><input type="text" value={t.he} onChange={e => upd({ he: e.target.value })} /></Field>
            <Field label="שם אנגלי מלא"><input type="text" dir="ltr" value={t.en} onChange={e => upd({ en: e.target.value })} /></Field>
            <Field label="סוג רשומה"><select value={t.kind} onChange={e => upd({ kind: e.target.value as Kind })}>{(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
              {t.kind === 'unclassified' && t.kindSuggestion && <span className="help">הצעת ייבוא (ממתינה להכרעה): {KIND_LABEL[t.kindSuggestion]} <button className="linkbtn small" onClick={() => upd({ kind: t.kindSuggestion! })}>אישור ההצעה</button></span>}</Field>
            <Field label="מעמד במאגר"><select value={t.policy} onChange={e => upd({ policy: e.target.value as Topic['policy'] })}>{(Object.keys(POLICY_LABEL) as Topic['policy'][]).map(k => <option key={k} value={k}>{POLICY_LABEL[k]}</option>)}</select></Field>
            <Field label="מצב פרסום"><select value={t.publish} onChange={e => upd({ publish: e.target.value as Topic['publish'] })}><option value="draft">טיוטה</option><option value="published">פורסם</option><option value="unpublished">הוסר מפרסום</option><option value="merged">הועבר לרשומה אחרת</option></select></Field>
            <Field label="משפחת כפילות (מזהה)" help="נושאים באותה משפחה מתריעים כאותו נושא (למשל COPD ואמפיזמה)."><input type="text" dir="ltr" value={t.familyId} onChange={e => upd({ familyId: e.target.value })} placeholder={`fam-${t.id}`} /></Field>
            <Field label="גיל מינימום (ריק = ללא מגבלה)"><input type="number" min={0} value={t.ageMin ?? ''} onChange={e => upd({ ageMin: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="גיל מקסימום כולל (ריק = ללא מגבלה)" help="ילדים: 18 כולל."><input type="number" min={0} value={t.ageMax ?? ''} onChange={e => upd({ ageMax: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="קושי באיתור (מידע מעשי בלבד)"><select value={t.difficulty} onChange={e => upd({ difficulty: Number(e.target.value) as 0 | 1 | 2 })}><option value={0}>ללא סימון</option><option value={1}>מאתגר למצוא מטופלים</option><option value={2}>מאתגר מאוד למצוא מטופלים</option></select></Field>
            <Field label="נוסף כחדש בשנת לימודים"><select value={t.addedYear ?? ''} onChange={e => upd({ addedYear: e.target.value || null })}><option value="">לא (אינו תוספת שנתית)</option>{catalog.years.map(y => <option key={y.id} value={y.id}>{y.label}</option>)}</select></Field>
          </div>
          <Field label="שמות חלופיים וקיצורים (שורה לכל שם)"><textarea dir="auto" value={t.aliases.join('\n')} onChange={e => upd({ aliases: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></Field>
          <label className="row"><input type="checkbox" checked={t.generalThreshold} onChange={e => upd({ generalThreshold: e.target.checked })} /> חל כלל הסף הכללי (כלל שלוש השנים מהטופס)</label>
          <Field label="מה כתוב במקור (טקסט המוצג למורה)"><textarea value={t.sourceCondition} onChange={e => upd({ sourceCondition: e.target.value })} /></Field>
          <Field label="נקודות לבירור (טקסט המוצג למורה)"><textarea value={t.reviewNote} onChange={e => upd({ reviewNote: e.target.value })} /></Field>
          <Field label="עמודי מקור"><input type="text" value={t.sourcePages} onChange={e => upd({ sourcePages: e.target.value })} /></Field>
          <fieldset><legend>קשרים לנושאים אחרים</legend>
            {t.relations.map((r, i) => (
              <div className="row" key={i} style={{ marginBlock: 4 }}>
                <select aria-label="סוג קשר" value={r.type} onChange={e => upd({ relations: t.relations.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof r.type } : x)) })} style={{ inlineSize: 'auto' }}>
                  {Object.entries({ excludes: 'מוחרג', conflicts_with: 'סתירה במקור', same_family: 'אותו נושא לכפילות', related: 'קשור', broader_than: 'קטגוריה רחבה של', redirects_to: 'מפנה לאבחנה', allowed_together: 'אפשר באותה כיתה' }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <select aria-label="נושא יעד" value={r.targetId} onChange={e => upd({ relations: t.relations.map((x, j) => (j === i ? { ...x, targetId: e.target.value } : x)) })} style={{ inlineSize: 'auto', maxInlineSize: 260 }}>
                  <option value={r.targetId}>{all.data?.find(x => x.id === r.targetId)?.he ?? r.targetId}</option>{(all.data ?? []).filter(x => x.id !== t.id && x.id !== r.targetId).map(x => <option key={x.id} value={x.id}>{x.he}</option>)}</select>
                <button className="btn small danger" aria-label="הסרת קשר" onClick={() => upd({ relations: t.relations.filter((_, j) => j !== i) })}>✕</button>
              </div>))}
            <button className="btn small secondary" onClick={() => upd({ relations: [...t.relations, { type: 'related', targetId: all.data?.[0]?.id ?? '' }] })}>הוספת קשר</button>
          </fieldset>
        </div>
      )}

      {tab === 'class' && (
        <div className="card stack">
          <fieldset><legend>מערכות (הראשונה שנבחרה היא העיקרית)</legend>
            <div className="grid cols2">{catalog.systems.map(s => <label className="row" key={s.id}><input type="checkbox" checked={t.systems.includes(s.id)} onChange={e => upd({ systems: e.target.checked ? [...t.systems, s.id] : t.systems.filter(x => x !== s.id), systemsNeedReview: false })} /> {s.label}</label>)}</div>
            {t.systemsRaw.length > 0 && <p className="help">מינוח המקור: {t.systemsRaw.join(' · ')}{t.systemsNeedReview && ' (שיוך טרם הוכרע במלואו)'}</p>}
          </fieldset>
          <fieldset><legend>תגיות מאושרות</legend>
            <div className="grid cols2">{catalog.tags.map(g => <label className="row" key={g.id}><input type="checkbox" checked={t.tags.includes(g.id)} onChange={e => upd({ tags: e.target.checked ? [...t.tags, g.id] : t.tags.filter(x => x !== g.id) })} /> {g.label}</label>)}</div>
            <p className="help">יש להבחין בין גנטי לתורשתי, בין מולד לתורשתי ובין גידול שפיר לממאיר. אין להפעיל תנאי סרטן על גידול רק בגלל המילה "גידול".</p>
          </fieldset>
          {t.suggestedTags.length > 0 && <Notice kind="info" title="הצעות תיוג ממתינות להכרעה: ">{t.suggestedTags.map(g => <span key={g} className="row" style={{ display: 'inline-flex', marginInlineEnd: 12 }}>{catalog.tags.find(x => x.id === g)?.label ?? g} <button className="btn small" onClick={() => upd({ tags: [...new Set([...t.tags, g])], suggestedTags: t.suggestedTags.filter(x => x !== g) })}>אישור</button><button className="btn small secondary" onClick={() => upd({ suggestedTags: t.suggestedTags.filter(x => x !== g) })}>דחייה</button></span>)}</Notice>}
        </div>
      )}

      {tab === 'rules' && (
        <div className="stack">
          <div className="card stack">
            <h3 style={{ marginBlockStart: 0 }}>כיסוי כללי הבדיקה</h3>
            <p className="help">תשובה חיובית למקרה ניתנת רק בכיסוי מלא: אישור מנהל שכל התנאים הרלוונטיים מקודדים, כולל כללי סף. עצם היעדר כללים אינו ראיה לכך שהתנאים מתקיימים.</p>
            <div className="grid cols2">
              <Field label="רמת כיסוי"><select value={t.coverage.level} onChange={e => upd({ coverage: { ...t.coverage, level: e.target.value as Topic['coverage']['level'], approvedBy: e.target.value === 'full' ? (t.coverage.approvedBy || ctx.user?.displayName || ctx.user?.email) : t.coverage.approvedBy, approvedAt: e.target.value === 'full' ? Date.now() : t.coverage.approvedAt } })}><option value="none">חסר</option><option value="partial">חלקי</option><option value="full">מלא</option></select></Field>
              <Field label="מאשר"><input type="text" value={t.coverage.approvedBy ?? ''} onChange={e => upd({ coverage: { ...t.coverage, approvedBy: e.target.value } })} /></Field>
            </div>
            <Field label="נימוק"><input type="text" value={t.coverage.reason} onChange={e => upd({ coverage: { ...t.coverage, reason: e.target.value } })} /></Field>
            <label className="row"><input type="checkbox" checked={!!t.coverage.noCaseRulesNeeded} onChange={e => upd({ coverage: { ...t.coverage, noCaseRulesNeeded: e.target.checked } })} /> הכרעת מנהל מפורשת: אין צורך בשאלות מקרה לנושא זה</label>
          </div>
          {issues.length > 0 && <div className="card">{issues.map((i, k) => <p key={k} className={i.level === 'error' ? 'err' : 'muted'}>{i.level === 'error' ? '✕ ' : '! '}{i.message}</p>)}</div>}
          <RuleSetEditor value={t.rules} onChange={rules => upd({ rules })} policyQuestions={pq.data ?? []} />
        </div>
      )}

      {tab === 'notes' && <NotesEditor notes={t.notes} onChange={notes => upd({ notes })} />}

      {tab === 'preview' && (
        <div className="stack">
          <Notice kind="info">כך המורה יראה את הכרטיס ואת הבדיקה. נתוני הדמיה מלאכותיים בלבד.</Notice>
          <TopicCard topic={t} sources={0} />
          <CaseCheck topic={t} general={catalog.generalRules} policyLabel={POLICY_LABEL[t.policy]} officialFormUrl={catalog.settings.officialFormUrl} simulate />
        </div>
      )}

      {tab === 'history' && <Versions id={t.id} />}

      <div className="card row" style={{ position: 'sticky', insetBlockEnd: 8 }}>
        <button className="btn secondary" disabled={busy} onClick={() => save(false)}>שמירה</button>
        <button className="btn" disabled={busy || errors.length > 0 || !t.he.trim()} onClick={() => save(true)}>שמירה ופרסום בקטלוג</button>
        {errors.length > 0 && <span className="err small">לא ניתן לפרסם עד תיקון השגיאות בלשונית "תנאים".</span>}
        {msg && <span role="status">{msg}</span>}
        {error && <span className="err" role="alert">{error}{conflict && <> <button className="btn small" onClick={() => { setT(null); loaded.reload(); setError(null); }}>טעינה מחדש</button></>}</span>}
      </div>
    </div>
  );
}
void ConflictError;

function NotesEditor({ notes, onChange }: { notes: Note[]; onChange: (n: Note[]) => void }) {
  const set = (i: number, p: Partial<Note>) => onChange(notes.map((n, j) => (j === i ? { ...n, ...p } : n)));
  return (
    <div className="stack">
      <p className="help">סוגי הערות: תנאי התאמה (משפיע על התוצאה דרך הכללים), קושי באיתור (מידע מעשי), שים לב (הסבר למורה), נדרש בירור (תנאי שטרם הוכרע).</p>
      {notes.map((n, i) => (
        <div className="card stack" key={n.id}>
          <div className="grid cols2">
            <Field label="סוג"><select value={n.type} onChange={e => set(i, { type: e.target.value as Note['type'] })}><option value="condition">תנאי התאמה</option><option value="difficulty">קושי באיתור</option><option value="attention">שים לב</option><option value="clarification">נדרש בירור</option></select></Field>
            <Field label="חומרת תצוגה"><select value={n.severity} onChange={e => set(i, { severity: e.target.value as Note['severity'] })}><option value="info">מידע</option><option value="warning">אזהרה</option><option value="high">חשוב</option></select></Field>
          </div>
          <Field label="כותרת קצרה"><input type="text" value={n.title} onChange={e => set(i, { title: e.target.value })} /></Field>
          <Field label="טקסט מלא"><textarea value={n.text} onChange={e => set(i, { text: e.target.value })} /></Field>
          <div className="row"><label className="row"><input type="checkbox" checked={n.active} onChange={e => set(i, { active: e.target.checked })} /> פעילה</label><label className="row"><input type="checkbox" checked={n.showInResults} onChange={e => set(i, { showInResults: e.target.checked })} /> להציג גם ברשימת התוצאות</label>
            <button className="btn small danger" onClick={() => onChange(notes.filter((_, j) => j !== i))}>מחיקה</button></div>
        </div>
      ))}
      <div><button className="btn small secondary" onClick={() => onChange([...notes, { id: `n${Date.now()}`, type: 'attention', title: '', text: '', severity: 'warning', active: true, showInResults: true }])}>הוספת הערה</button></div>
    </div>
  );
}

function Versions({ id }: { id: string }) {
  const { api } = useRT();
  const v = useAsync(() => api.adminTopicVersions(id), [api, id]);
  if (v.loading) return <Loading />;
  return (
    <div className="stack">
      <p className="help">גרסה שנשמרה אינה נדרסת: כל שינוי יוצר גרסה חדשה. החלטות קודמות שומרות הפניה לגרסה הרלוונטית.</p>
      {(v.data ?? []).map(x => <div className="card" key={x.version}><b>גרסה {x.version}</b> · {fmtDate(x.updatedAt)} · מעמד: {POLICY_LABEL[x.policy]} · כיסוי: {x.coverage.level} · גיל: {x.ageMin ?? '—'}–{x.ageMax ?? '—'} · {x.rules.rules.length} כללים</div>)}
      {v.data?.length === 0 && <p className="muted">אין גרסאות שמורות עדיין.</p>}
    </div>
  );
}

// ───────── בקשות והחלטות ─────────
type RqFilter = 'todo' | 'in_progress' | 'waiting_teacher' | 'done' | 'all';
function RequestsAdmin() {
  const { api } = useRT();
  const { catalog } = useCatalog();
  const { refreshBadges } = useSession();
  const rq = useAsync(() => api.adminListRequests(), [api]);
  const [filter, setFilter] = useState<RqFilter>('todo');
  const [sel, setSel] = useState<RequestDoc | null>(null);
  const [reply, setReply] = useState(''); const [kind, setKind] = useState<NonNullable<RequestDoc['decisionKind']>>('supplement');
  const { busy, error, run } = useBusy();
  const nav = useNavigate();
  const now = Date.now();
  const done = () => { rq.reload(); refreshBadges(true); };
  const match = (r: RequestDoc) => filter === 'all' || (filter === 'todo' && r.status === 'open') || (filter === 'in_progress' && r.status === 'in_progress')
    || (filter === 'waiting_teacher' && r.status === 'waiting_teacher') || (filter === 'done' && (r.status === 'answered' || r.status === 'closed'));
  const all = rq.data ?? [];
  const count = (f: RqFilter) => all.filter(r => (f === 'all' ? true : f === 'todo' ? r.status === 'open' : f === 'done' ? r.status === 'answered' || r.status === 'closed' : r.status === f)).length;
  const FILTERS: [RqFilter, string][] = [['todo', 'חדשות וממתינות לטיפול'], ['in_progress', 'בטיפול'], ['waiting_teacher', 'ממתינות למורה'], ['done', 'נענו או נסגרו'], ['all', 'הכול']];
  return (
    <div className="stack">
      <h2>בקשות והחלטות</h2>
      <p className="muted small">יעד טיפול: {catalog?.settings.responseDueDays} ימים. היעד אינו מחייב ואינו משנה תוצאה; חלוף הזמן אינו אישור. המורה רואה את המענה ב"הבקשות שלי" כשייכנס לאתר. אל תעתיקו טקסט של בקשה אישית לכרטיס ציבורי.</p>
      <div className="tabs-lite" role="group" aria-label="סינון בקשות">{FILTERS.map(([f, l]) => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{l} ({count(f)})</button>)}</div>
      {rq.loading && <Loading />}
      {rq.data && all.filter(match).length === 0 && <div className="card empty">אין בקשות בסינון זה.</div>}
      {all.filter(match).sort((a, b) => a.createdAt - b.createdAt).map(r => (
        <div className={`card stack ${r.status === 'open' ? 'isnew' : ''}`} key={r.id}>
          <div className="row between"><b>{REQUEST_KIND_LABEL[r.kind]}{r.proposedHe ? `: ${r.proposedHe}` : ''}</b>
            <span className="badge neutral">{requestStateLabel(r)}</span></div>
          <div className="small muted">{fmtDate(r.createdAt)} · יעד {fmtDate(r.dueAt)} {isOverdue(r, now) && <span className="badge warn">חרגה מהיעד</span>}{r.topicId && ` · נושא: ${catalog?.topics.find(t => t.id === r.topicId)?.he}`}</div>
          <p>{r.description}</p>{r.rationale && <p><b>נימוק:</b> {r.rationale}</p>}{r.supplement && <p><b>השלמת המורה:</b> {r.supplement}</p>}
          {r.adminReply && <Notice kind="info" title="המענה שנמסר: ">{r.adminReply}{r.repliedAt && <span className="small muted"> · {fmtDate(r.repliedAt)}{r.teacherSeenAt ? ' · המורה ראה' : ' · טרם נראה בידי המורה'}</span>}</Notice>}
          <div className="row">
            <button className="btn small secondary" onClick={() => { setSel(r); setReply(r.adminReply ?? ''); setKind(r.decisionKind ?? 'supplement'); }}>מענה והחלטה</button>
            {r.status === 'open' && <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.adminSetRequestStatus(r.id, 'in_progress')).then(done)}>סימון "בטיפול"</button>}
            {r.status !== 'closed' && <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.adminSetRequestStatus(r.id, 'closed')).then(done)}>סגירה</button>}
            {r.kind === 'new_topic' && <button className="btn small" onClick={() => nav('/admin/topics/new')}>יצירת כרטיס נושא (טיוטה)</button>}
          </div>
        </div>
      ))}
      {sel && (
        <div className="card stack" role="dialog" aria-label="מענה לבקשה">
          <h3 style={{ margin: 0 }}>מענה לבקשה</h3>
          <Field label="החלטה"><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="supplement">בקשת השלמה מהמורה</option><option value="general_approval">אושרה (אישור כללי: הפיכה לכרטיס או לעדכון מדיניות)</option><option value="case_specific">אושרה נקודתית (אינה מתפרסמת כהיתר כללי)</option><option value="rejection">לא אושרה (עם הסבר וכתובת לפנייה אישית)</option></select></Field>
          <Field label="מענה למורה (ללא פרטי מקרה רפואי)"><textarea value={reply} onChange={e => setReply(e.target.value)} /></Field>
          {kind === 'general_approval' && <Notice kind="info">אישור כללי מחייב כרטיס מלא (שם, מעמד, מערכת, תנאים, מקור ותחולה). צרו או ערכו את הכרטיס והעבירו לפרסום; מענה אישי וכללי הם פעולות נפרדות.</Notice>}
          {error && <p className="err">{error}</p>}
          <div className="row"><button className="btn" disabled={busy || !reply.trim()} onClick={() => run(() => api.adminReply(sel.id, { decisionKind: kind, text: reply, status: kind === 'supplement' ? 'waiting_teacher' : 'answered' })).then(r => { if (r !== undefined) { setSel(null); done(); } })}>שמירת המענה</button><button className="btn secondary" onClick={() => setSel(null)}>ביטול</button></div>
        </div>
      )}
    </div>
  );
}

// ───────── מקורות איתור ─────────
function SourcesAdmin() {
  const { api } = useRT();
  const { catalog, reloadSources } = useCatalog();
  const { refreshBadges } = useSession();
  const [only, setOnly] = useState<'new' | 'all'>('new');
  const s = useAsync(() => api.adminListSources(only === 'new'), [api, only]);
  const reports = useAsync(() => api.adminListSourceReports(true), [api]);
  const { busy, run } = useBusy();
  const reportsOf = (id: string) => reports.data?.filter(x => x.sourceId === id) ?? [];
  const reload = () => { s.reload(); reports.reload(); reloadSources(); refreshBadges(true); };
  const list = (s.data ?? []).sort((a, b) => b.createdAt - a.createdAt);
  const unreviewed = list.filter(x => x.reviewed === false);
  return (
    <div className="stack">
      <h2>מקורות איתור</h2>
      <p className="muted small">מקור שמורה מוסיף מתפרסם מיד, ומופיע כאן כ"חדש" עד שמסמנים "נבדק". רק מנהל יכול לערוך או להסיר. דיווח אינו מסתיר מקור אוטומטית. כל משתמש יכול להוסיף עד 5 מקורות ביום.</p>
      <div className="tabs-lite" role="group" aria-label="סינון מקורות"><button className="chip" aria-pressed={only === 'new'} onClick={() => setOnly('new')}>חדשים שטרם נבדקו</button><button className="chip" aria-pressed={only === 'all'} onClick={() => setOnly('all')}>כל המקורות</button></div>
      {unreviewed.length > 1 && <div><button className="btn small" disabled={busy} onClick={() => run(() => api.adminMarkSourcesReviewed(unreviewed.map(x => x.id))).then(reload)}>סימון כל החדשים כנבדקו ({unreviewed.length})</button></div>}
      {s.loading && <Loading />}
      {s.data && list.length === 0 && <div className="card empty">{only === 'new' ? 'אין מקורות חדשים שטרם נבדקו.' : 'אין מקורות.'}</div>}
      <div className="tablewrap"><table><thead><tr><th>כותרת</th><th>נושא</th><th>מצב</th><th>דיווחים</th><th></th></tr></thead>
        <tbody>{list.map(x => (
          <tr key={x.id}><td><b>{x.title}</b>{x.reviewed === false && <span className="badge warn">חדש</span>}<div className="small muted">{x.text.slice(0, 100)} · {fmtDate(x.createdAt)}</div></td><td>{catalog?.topics.find(t => t.id === x.topicId)?.he ?? x.topicId}</td>
            <td>{x.visible ? <span className="badge ok">גלוי</span> : <span className="badge neutral">הוסר</span>}</td>
            <td>{reportsOf(x.id).length > 0 ? <span className="badge warn">{reportsOf(x.id).length}</span> : '—'}{reportsOf(x.id).map(r => <div key={r.id} className="small">{r.reason} <button className="linkbtn small" onClick={() => run(() => api.adminHandleReport(r.id)).then(reload)}>טופל</button></div>)}</td>
            <td><div className="row">
              {x.reviewed === false && <button className="btn small" disabled={busy} onClick={() => run(() => api.adminMarkSourcesReviewed([x.id])).then(reload)}>נבדק</button>}
              <button className="btn small secondary" onClick={() => { const t = prompt('כותרת חדשה', x.title); if (t) run(() => api.adminEditSource(x.id, { title: t })).then(reload); }}>עריכה</button>
              {x.visible ? <button className="btn small danger" disabled={busy} onClick={() => run(() => api.adminRemoveSource(x.id)).then(reload)}>הסרה</button> : <button className="btn small" onClick={() => run(() => api.adminRestoreSource(x.id)).then(reload)}>שחזור</button>}</div></td></tr>))}</tbody></table></div>
    </div>
  );
}

// ───────── הצעות ─────────
function SuggestionsAdmin() {
  const { api } = useRT();
  const s = useAsync(() => api.listSuggestions(), [api]);
  const { run } = useBusy();
  return (
    <div className="stack">
      <h2>הצעות לתגיות, נושאים ועדכוני מקור</h2>
      <Notice kind="info" title="מחבר חיצוני לא מוגדר. ">מנגנון ההצעה האוטומטית (בינה מלאכותית או חיפוש) טרם חובר. המבנה והמסך מוכנים; לא מוצגות תוצאות דוגמה כאילו התקבלו משירות אמיתי. כרגע מגיעות לכאן הצעות עדכון מייבוא חוזר של המקור בלבד.</Notice>
      {s.data?.length === 0 && <div className="card empty">אין הצעות.</div>}
      {s.data?.map((x: any) => (
        <div className="card row between" key={x.id}>
          <div><b>{x.type === 'seed_update' ? `עדכון במקור ${x.seedId}` : x.type}</b><div className="small muted">שדות ששונו: {(x.changedFields ?? []).join(', ')} · {fmtDate(x.createdAt)}</div></div>
          {x.state === 'open' ? <div className="row"><button className="btn small" onClick={() => run(() => api.resolveSuggestion(x.id, 'accepted')).then(s.reload)}>סימון כטופל</button><button className="btn small secondary" onClick={() => run(() => api.resolveSuggestion(x.id, 'rejected')).then(s.reload)}>דחייה</button></div> : <span className="badge neutral">{x.state === 'accepted' ? 'טופל' : 'נדחה'}</span>}
        </div>))}
    </div>
  );
}

// ───────── מוסדות ─────────
function SchoolsAdmin() {
  const { api } = useRT();
  const sc = useAsync(() => api.adminListSchools(), [api]);
  const [csv, setCsv] = useState('');
  const [prev, setPrev] = useState<Awaited<ReturnType<typeof api.adminPreviewSchools>> | null>(null);
  const [res, setRes] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  return (
    <div className="stack">
      <h2>מוסדות</h2>
      <p className="muted small">רשימת הקודים הרשמית תימסר בהמשך. שם מוסד אינו מזהה ייחודי; שינוי שם אינו מוחק היסטוריה.</p>
      <div className="card stack">
        <b>ייבוא CSV (עמודות: קוד, שם, יישוב)</b>
        <textarea dir="auto" value={csv} onChange={e => { setCsv(e.target.value); setPrev(null); }} placeholder={'קוד,שם,יישוב\n123456,שם מוסד,עיר'} />
        <input type="file" accept=".csv,text/csv" aria-label="קובץ CSV" onChange={async e => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setPrev(null); } }} />
        <div className="row"><button className="btn secondary small" disabled={busy || !csv.trim()} onClick={() => run(() => api.adminPreviewSchools(csv)).then(p => p && setPrev(p))}>תצוגה מקדימה</button>
          {prev && <button className="btn small" disabled={busy} onClick={() => run(() => api.adminApplySchools(csv)).then(r => { if (r) { setRes(`נכתבו ${r.applied}, נדחו ${r.rejected}.`); setPrev(null); setCsv(''); sc.reload(); } })}>אישור הייבוא</button>}</div>
        {prev && <div className="tablewrap"><table><thead><tr><th>שורה</th><th>קוד</th><th>שם</th><th>מצב</th></tr></thead><tbody>{prev.map(r => <tr key={r.line}><td>{r.line}</td><td><bdi className="ltr">{r.school.id}</bdi></td><td>{r.school.name}</td><td>{{ new: 'חדש', update: 'עדכון', error: 'שגיאה', duplicate_in_file: 'כפול בקובץ' }[r.status]}{r.message && ` · ${r.message}`}</td></tr>)}</tbody></table></div>}
        {res && <Notice kind="ok"><span role="status">{res}</span></Notice>}{error && <p className="err">{error}</p>}
      </div>
      <SchoolForm onDone={sc.reload} />
      <div className="tablewrap"><table><thead><tr><th>קוד</th><th>שם</th><th>יישוב</th><th>פעיל</th></tr></thead><tbody>{(sc.data ?? []).map(s => <tr key={s.id}><td><bdi className="ltr">{s.id}</bdi></td><td>{s.name}</td><td>{s.city}</td><td>{s.active ? 'כן' : 'לא'}</td></tr>)}</tbody></table></div>
    </div>
  );
}
function SchoolForm({ onDone }: { onDone: () => void }) {
  const { api } = useRT();
  const [s, setS] = useState({ id: '', name: '', city: '' });
  const { busy, error, run } = useBusy();
  return (
    <form className="card row" onSubmit={e => { e.preventDefault(); run(() => api.adminSaveSchool({ ...s, active: true })).then(r => { if (r !== undefined) { setS({ id: '', name: '', city: '' }); onDone(); } }); }}>
      <Field label="קוד"><input type="text" dir="ltr" required value={s.id} onChange={e => setS({ ...s, id: e.target.value.trim() })} /></Field>
      <Field label="שם"><input type="text" required value={s.name} onChange={e => setS({ ...s, name: e.target.value })} /></Field>
      <Field label="יישוב"><input type="text" value={s.city} onChange={e => setS({ ...s, city: e.target.value })} /></Field>
      <button className="btn" disabled={busy} style={{ alignSelf: 'end' }}>הוספה או תיקון</button>{error && <span className="err">{error}</span>}
    </form>
  );
}

// ───────── מחזורים וסגירה ─────────
function CyclesAdmin() {
  const { api } = useRT();
  const { catalog, reload } = useCatalog();
  const [yearId, setYearId] = useState(catalog!.settings.currentYearId);
  const sum = useAsync(() => api.cycleClosePreview(yearId), [api, yearId]);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [force, setForce] = useState(false);
  const year = catalog!.years.find(y => y.id === yearId);
  const startYears = Array.from({ length: 12 }, (_, i) => startYearOf(catalog!.settings.currentYearId) - 5 + i).map(academicYear);
  const p = sum.data;
  const notEnded = p?.yearEnded === false;
  const ready = confirmText === yearId && (!notEnded || force);
  return (
    <div className="stack">
      <h2>מחזורים וסיום שנה</h2>
      <p className="muted small">הניקוי ידני: מנהל מפעיל אותו אחרי שהשנה הסתיימה. לפני המחיקה מוצג מה יושפע, ושום דבר אינו נמחק עד שמאשרים.</p>
      <Field label="שנת לימודים"><select value={yearId} onChange={e => { setYearId(e.target.value); setConfirmText(''); setForce(false); }}>{startYears.map(y => <option key={y.id} value={y.id}>{y.label} ({y.id}){catalog!.years.find(z => z.id === y.id)?.closed ? ' · נסגרה' : ''}</option>)}</select></Field>
      <div className="card stack">
        {sum.loading ? <Loading /> : p && (<>
          <h3 style={{ margin: 0 }}>מה יושפע אם סוגרים את {yearId}</h3>
          <ul className="tight">
            <li>קבוצות שיימחקו: <b>{p.groups}</b> ב־<b>{p.schools}</b> מוסדות</li>
            <li>קבוצות עם שמות או כינויי תלמידים: <b>{p.withNames}</b> ({p.studentLabels} כינויים שיימחקו)</li>
            <li>רשומות היסטוריה שיעודכנו: <b>{p.historyRecordsToWrite}</b> (מוסד, שנה, נושא ומצב בלבד)</li>
            <li>בקשות שתנותק מהן ההפניה לקבוצה: <b>{p.linkedRequests}</b> (הבקשה עצמה נשארת)</li>
            {Object.entries(p.byStatus).map(([k, v]) => <li key={k}>מצב "{GROUP_STATUS_LABEL[k] ?? k}": {v}</li>)}
          </ul>
          {p.activeGroups > 0 && <Notice kind="warn" title="שימו לב: ">{p.activeGroups} קבוצות עדיין לא סומנו כבוצעו או כבוטלו. הן יירשמו בהיסטוריה כ"אושר ולא בוצע". כדאי לוודא שהמורים והרכזים עדכנו.</Notice>}
          {notEnded && <Notice kind="bad" title="המחזור טרם הסתיים: ">תאריך הסיום שהוגדר הוא {p.yearEnd}. סגירה כעת תמחק עבודות פעילות. כדי להמשיך יש לסמן אישור מפורש.<label className="row"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} /> אני מבין שהמחזור טרם הסתיים וברצוני לסגור אותו בכל זאת</label></Notice>}
        </>)}
        {(p?.alreadyClosed || year?.closed) && <Notice kind="ok">המחזור נסגר{p?.closedAt ? ` ב־${fmtDate(p.closedAt)}` : ''}. נשארה היסטוריית נושאים בלבד. הרצה חוזרת בטוחה ואינה מוחקת דבר נוסף אם אין קבוצות.</Notice>}
        <Notice kind="info" title="מה נשאר אחרי הסגירה: ">היסטוריית נושאים (מוסד, שנה, נושא, מצב), כרטיסי הנושאים והכללים, המקורות, הבקשות (בלי הפניה לקבוצה), פרופילי המורים והשיוך למוסדות, ויומן המחיקות. <b>מה שנמחק:</b> הקבוצות, ובתוכן מספר התלמידים, הכינויים, סטטוס הקבוצה ומספר הבדיקות שדווחו. מחיקת היסטוריה ישנה אינה מופעלת אוטומטית, ומחייבת החלטה נפרדת.</Notice>
        <Notice kind="warn" title="לפני שמוחקים: ">מומלץ להוריד גיבוי פרטי (לשונית "גיבוי ושחזור") רק אם צריך לשמור את הנתונים, ולשמור אותו במקום מוגן. שחזור גיבוי ישן לא יחזיר קבוצות של מחזור שנסגר.</Notice>
        <Field label={`להקלדת אישור, כתבו את מזהה השנה: ${yearId}`}><input type="text" dir="ltr" value={confirmText} onChange={e => setConfirmText(e.target.value)} /></Field>
        <div className="row"><button className="btn danger" disabled={busy || !ready} onClick={() => run(() => api.closeCycle(yearId, { force })).then(r => { if (r) { setMsg(`נמחקו ${r.deleted} קבוצות. ההיסטוריה עודכנה.`); setConfirmText(''); setForce(false); sum.reload(); reload(); } })}>סגירת המחזור ומחיקת פרטי התלמידים</button>
          <button className="btn secondary" disabled={busy} onClick={() => run(() => api.reapplyDeletions()).then(r => r && setMsg(`הופעלו מחדש מחיקות: ${r.deleted} קבוצות הוסרו.`))}>הפעלה מחדש של מחיקות (אחרי שחזור)</button></div>
        {msg && <Notice kind="ok"><span role="status">{msg}</span></Notice>}{error && <p className="err" role="alert">{error}</p>}
      </div>
      <p className="small muted">הפעולה אינה הפיכה. היא אינה מוחקת קובצי גיבוי שכבר הורדו: היומן מבטיח שבשחזור מהם לא יחזרו קבוצות של מחזור שנסגר. אין להעתיק נתוני תלמידים ל־GitHub או לקובצי seed.</p>
    </div>
  );
}

// ───────── משתמשים והרשאות ─────────
function UsersAdmin() {
  const { api } = useRT();
  const { ctx } = useSession();
  const p = useAsync(() => api.adminListProfiles(), [api]);
  const sc = useAsync(() => api.adminListSchools(), [api]);
  const [schoolFor, setSchoolFor] = useState<Record<string, string>>({});
  const { busy, error, run } = useBusy();
  return (
    <div className="stack">
      <h2>משתמשים והרשאות</h2>
      <Notice kind="info">קידום מתבצע רק מתוך משתמשים שנרשמו ואימתו כתובת, ולא לפי כתובת שהוקלדה. לא ניתן להסיר את המנהל האחרון. מנהל ראשון נקבע בתהליך אתחול בצד השירות (ראו מדריך ההפעלה).</Notice>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="tablewrap"><table><thead><tr><th>שם</th><th>מייל</th><th>אימות</th><th>תפקיד</th><th>פעולות</th></tr></thead><tbody>
        {(p.data ?? []).map(u => (
          <tr key={u.uid}><td>{u.displayName}</td><td><bdi className="ltr">{u.email}</bdi></td><td>{u.emailVerified ? 'מאומת' : 'לא מאומת'}</td>
            <td>{u.roleDoc ? ({ admin: 'מנהל', coordinator: `רכז (${u.roleDoc.schoolId})`, teacher: 'מורה' }[u.roleDoc.role as Role]) : 'מורה'}</td>
            <td><div className="row">
              <button className="btn small secondary" disabled={busy || u.roleDoc?.role === 'admin'} onClick={() => run(() => api.adminGrantRole(u.uid, 'admin')).then(p.reload)}>מינוי למנהל</button>
              <select aria-label="מוסד לרכז" style={{ inlineSize: 'auto' }} value={schoolFor[u.uid] ?? ''} onChange={e => setSchoolFor({ ...schoolFor, [u.uid]: e.target.value })}><option value="">מוסד…</option>{sc.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <button className="btn small secondary" disabled={busy || !schoolFor[u.uid]} onClick={() => run(() => api.adminGrantRole(u.uid, 'coordinator', schoolFor[u.uid])).then(p.reload)}>מינוי לרכז</button>
              {u.roleDoc && <button className="btn small danger" disabled={busy || u.uid === ctx.user?.uid && u.roleDoc.role === 'admin' && false} onClick={() => run(() => api.adminRevokeRole(u.uid)).then(p.reload)}>הסרת תפקיד</button>}</div></td></tr>))}</tbody></table></div>
    </div>
  );
}

// ───────── בירורים מקצועיים ─────────
const SEED_QUESTIONS: Omit<PolicyQuestion, 'state' | 'answer'>[] = [
  { id: 'pq-01', topic: 'מסלול הריון', source: 'סעיף 25(1) במפרט', question: 'תקין לעומת סיכון, תחילת מעקב עד שבוע 20, סוכרת הריונית מאוחרת, השוואת מצבים וסיום מוקדם. (שבוע 20 מתייחס להתחלת מעקב, לא לסיומו; המסלול נדחה להשלמה. אין מנגנון אישור אוטומטי.)', owner: 'שולי' },
  { id: 'pq-02', topic: 'אוטם בשריר הלב', source: 'סעיף 25(2); S001', question: 'חלון חצי שנה מול שנה והגדרת מועד הייחוס.', owner: 'שולי' },
  { id: 'pq-03', topic: 'מחלה אקוטית שהחלימה', source: 'סעיף 25(3)', question: 'היחס לדרישת ביטויים וטיפול בהווה.', owner: 'שולי' },
  { id: 'pq-04', topic: 'מחלה מאוזנת', source: 'סעיף 25(4)', question: 'היחס בין היעדר תסמינים, ממצאים אובייקטיביים ומעקב בלבד. הטופס הנוכחי הוא נקודת המוצא; מנהל יכול לשנות.', owner: 'שולי' },
  { id: 'pq-05', topic: 'סרטן', source: 'סעיף 25(5); S036, S094', question: 'זמן לאחר ניתוח, טיפול בלי ניתוח, מחלה מתמשכת והפוגה. מחלה שלא הוגדרה כהחלמה ונמצאת במעקב קבוע יכולה להיות רלוונטית; לא כל מעקב לאחר החלמה מספיק.', owner: 'שולי' },
  { id: 'pq-06', topic: 'כליות', source: 'סעיף 25(6); S012', question: 'תרופות ומעקב קבוע יכולים להספיק גם ללא דיאליזה או השתלה. נדרש ניסוח כלל מקצועי מפורש.', owner: 'שולי' },
  { id: 'pq-07', topic: 'השימוטו', source: 'סעיף 25(7); S089, S100', question: 'סתירה בין האישור האוטואימוני להחרגת תת־פעילות תריס.', owner: 'שולי' },
  { id: 'pq-08', topic: 'מיגרנה ואקנה', source: 'סעיף 25(8); S050, S074', question: 'משמעות חומרה, ללא המצאת ספים.', owner: 'שולי' },
  { id: 'pq-09', topic: 'טיפול תרופתי או מניעה בלבד', source: 'סעיף 25(9)', question: 'כיצד מפרשים את ההחרגה מול מחלות שמאושרות במפורש.', owner: 'שולי' },
  { id: 'pq-10', topic: 'סרטן באותו איבר', source: 'סעיף 25(10)', question: 'מתי תתי־גידולים נחשבים נושאים נפרדים.', owner: 'שולי' },
  { id: 'pq-11', topic: 'מונחי זמן עמומים', source: 'סעיף 25(11)', question: '"מיד", "זמן קצר" וחצי שנה אחרי ניתוח. אין לקודד מספר ימים שרירותי.', owner: 'שולי' },
  { id: 'pq-12', topic: 'קוליטיס כיבית', source: 'סעיף 25(12); S114', question: 'נמצאת בדוגמת עבודה אך אינה נקובה בשם בנספח הנושאים. האם להוסיף כנושא מאושר?', owner: 'שולי' },
  { id: 'pq-13', topic: 'היפרדות רשתית וראייה כפולה', source: 'סעיף 25(13); S068, S069', question: 'האם הנוסח מתאר שני נושאים או צירוף.', owner: 'שולי' },
  { id: 'pq-14', topic: 'סיווגים רפואיים בעייתיים', source: 'סעיף 25(14); S049', question: 'למשל מיקום ALS ברשימה האוטואימונית, בלי להפוך שגיאת סיווג לפסילת הנושא.', owner: 'שולי' },
  { id: 'pq-15', topic: 'גיל: מועד הייחוס', source: 'סעיף 25(15)', question: 'מועד הייחוס: בעת הבדיקה או תחילת המעקב. (ברירת המימוש: גיל בזמן הבדיקה, ללא מעמד של הכרעה סופית. גיל 18 כלול; הטווח לכל מחלה ניתן לעריכה.)', owner: 'שולי' },
];

function QuestionsAdmin() {
  const { api } = useRT();
  const q = useAsync(() => api.listPolicyQuestions(), [api]);
  const { ctx } = useSession();
  const { busy, error, run } = useBusy();
  const merged: PolicyQuestion[] = SEED_QUESTIONS.map(s => q.data?.find(x => x.id === s.id) ?? { ...s, state: 'open' as const, answer: '' });
  const extra = (q.data ?? []).filter(x => !SEED_QUESTIONS.some(s => s.id === x.id));
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <div className="stack">
      <h2>בירורים מקצועיים פתוחים</h2>
      <p className="muted small">אלה שאלות שטרם הוכרעו. המערכת מטפלת בהן בבירור: מציגה "דורש בירור" ואינה ממציאה תשובה. הזנת הכרעה כאן אינה משנה כללים אוטומטית: יש לעדכן את כללי הנושא בעורך, בגרסה חדשה.</p>
      {error && <p className="err">{error}</p>}
      {[...merged, ...extra].map(p => (
        <div className="card stack" key={p.id}>
          <div className="row between"><b>{p.topic}</b><span className={`badge ${p.state === 'open' ? 'warn' : 'ok'}`}>{p.state === 'open' ? 'פתוח' : 'הוכרע'}</span></div>
          <div className="small muted">מקור: {p.source} · אחראי: {p.owner}</div>
          <p>{p.question}</p>
          {p.state === 'answered' && <Notice kind="ok" title="הכרעה: ">{p.answer} <span className="small muted">({p.answeredBy}, {p.answeredAt && fmtDate(p.answeredAt)})</span></Notice>}
          <Field label="הכרעת מנהל"><textarea value={draft[p.id] ?? p.answer} onChange={e => setDraft({ ...draft, [p.id]: e.target.value })} /></Field>
          <div className="row"><button className="btn small" disabled={busy || !(draft[p.id] ?? '').trim()} onClick={() => run(() => api.savePolicyQuestion({ ...p, state: 'answered', answer: draft[p.id], answeredBy: ctx.user?.displayName || ctx.user?.email, answeredAt: Date.now() })).then(q.reload)}>שמירת הכרעה</button>
            {p.state === 'answered' && <button className="btn small secondary" onClick={() => run(() => api.savePolicyQuestion({ ...p, state: 'open' })).then(q.reload)}>פתיחה מחדש</button>}</div>
        </div>))}
    </div>
  );
}

// ───────── כללי סף כלליים ─────────
function GeneralRulesAdmin() {
  const { api } = useRT();
  const { catalog, reload } = useCatalog();
  const pq = useAsync(() => api.listPolicyQuestions(), [api]);
  const [rs, setRs] = useState<RuleSet>(catalog?.generalRules ?? DEFAULT_GENERAL_RULES);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const issues = validateRuleSet(rs, { level: 'partial', reason: 'כללי סף' }, { ageMin: null, ageMax: null });
  return (
    <div className="stack">
      <h2>כללי סף כלליים</h2>
      <Notice kind="info" title="הכלל היחיד שהוגדר: ">נוסח הטופס הקיים (כלל שלוש השנים). זהו כלל שלילה בלבד: אי־הפעלתו אינה אישור. הוא חל על נושאים שסומנו "חל כלל הסף הכללי". אין להוסיף כאן כללים רפואיים נוספים (מחלה מאוזנת, החלמה, מעקב) בלי הכרעה מקצועית.</Notice>
      {issues.map((i, k) => <p key={k} className={i.level === 'error' ? 'err' : 'muted'}>{i.message}</p>)}
      <RuleSetEditor value={rs} onChange={setRs} policyQuestions={pq.data ?? []} />
      <div className="row"><button className="btn" disabled={busy || issues.some(i => i.level === 'error')} onClick={() => run(() => api.saveGeneralRules(rs)).then(r => { if (r !== undefined) { setMsg('נשמר. השינוי חל על בדיקות חדשות (קדימה בלבד).'); reload(); } })}>שמירה</button>
        <button className="btn secondary" onClick={() => setRs(DEFAULT_GENERAL_RULES)}>שחזור נוסח הטופס המקורי</button>{msg && <span role="status">{msg}</span>}{error && <span className="err">{error}</span>}</div>
    </div>
  );
}

// ───────── הגדרות ─────────
function SettingsAdmin() {
  const { api } = useRT();
  const { catalog, reload } = useCatalog();
  const st = useAsync(() => api.getAdminSettings(), [api]);
  const [s, setS] = useState<Settings | null>(null);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  const [sys, setSys] = useState(''); const [tags, setTags] = useState('');
  if (st.data && !s) setS(st.data);
  const vocabText = useMemo(() => ({ sys: catalog?.systems.map(x => `${x.id}=${x.label}`).join('\n') ?? '', tags: catalog?.tags.map(x => `${x.id}=${x.label}`).join('\n') ?? '' }), [catalog]);
  if (!s) return <Loading />;
  const parse = (txt: string) => txt.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [id, ...r] = l.split('='); return { id: id.trim(), label: (r.join('=') || id).trim() }; });
  return (
    <div className="stack">
      <h2>הגדרות כלליות</h2>
      <div className="card stack">
        <Field label="קישור לטופס הרשמי"><input type="url" dir="ltr" value={s.officialFormUrl} onChange={e => setS({ ...s, officialFormUrl: e.target.value })} /></Field>
        <Field label="הנחיית מועד הגשה (מוצגת למורים)"><textarea value={s.submissionNote} onChange={e => setS({ ...s, submissionNote: e.target.value })} /></Field>
        <div className="grid cols2">
          <Field label="שם האחראי לפניות"><input type="text" value={s.responsibleName} onChange={e => setS({ ...s, responsibleName: e.target.value })} /></Field>
          <Field label="כתובת האחראי (נראית למשתמשים מחוברים בלבד)"><input type="email" dir="ltr" value={s.responsibleEmail} onChange={e => setS({ ...s, responsibleEmail: e.target.value })} /></Field>
          <Field label="יעד טיפול בבקשה (ימים קלנדריים)"><input type="number" min={1} value={s.responseDueDays} onChange={e => setS({ ...s, responseDueDays: Number(e.target.value) })} /></Field>
          <Field label="שנת הלימודים הנוכחית"><select value={s.currentYearId} onChange={e => setS({ ...s, currentYearId: e.target.value })}>{Array.from({ length: 6 }, (_, i) => academicYear(startYearOf(s.currentYearId) - 2 + i)).map(y => <option key={y.id} value={y.id}>{y.label} ({y.id})</option>)}</select></Field>
        </div>
        {error && <p className="err">{error}</p>}
        <div className="row"><button className="btn" disabled={busy} onClick={() => run(() => api.saveSettings(s)).then(r => { if (r !== undefined) { setMsg('נשמר.'); reload(); } })}>שמירת הגדרות</button>{msg && <span role="status">{msg}</span>}</div>
      </div>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>מילוני מערכות ותגיות</h3>
        <p className="help">שורה לכל פריט, בפורמט מזהה=תווית. מחיקת מערכת שנמצאת בשימוש אינה מוחקת את הנושאים.</p>
        <Field label="מערכות"><textarea dir="auto" value={sys || vocabText.sys} onChange={e => setSys(e.target.value)} style={{ minBlockSize: 160 }} /></Field>
        <Field label="תגיות"><textarea dir="auto" value={tags || vocabText.tags} onChange={e => setTags(e.target.value)} /></Field>
        <div><button className="btn" disabled={busy} onClick={() => run(() => api.saveVocab(parse(sys || vocabText.sys), parse(tags || vocabText.tags))).then(r => { if (r !== undefined) { setMsg('המילונים נשמרו.'); reload(); } })}>שמירת מילונים</button></div>
      </div>
    </div>
  );
}
