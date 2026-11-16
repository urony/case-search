import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { buildExceptionMailto, duplicateWarnings, DuplicateWarning } from '../../domain/helpers';
import type { Group, Topic } from '../../domain/types';
import { CoverageBadge, DifficultyMark, En, ErrorBox, fmtDate, Loading, Notice, PolicyBadge, POLICY_LABEL, Tabs, useAsync, useBusy } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';
import { loadSchoolHistories } from '../history';
import CaseCheck from './CaseCheck';
import { ageText } from './Home';
import { SourcesPanel } from './Sources';

type Tab = 'conditions' | 'check' | 'sources';

const REL_LABEL: Record<string, string> = {
  excludes: 'מוחרג', conflicts_with: 'סתירה במקור', same_family: 'אותו נושא לצורך כפילות', related: 'קשור',
  broader_than: 'קטגוריה רחבה של', redirects_to: 'מפנה לבחירת אבחנה, למשל', allowed_together: 'אפשר באותה כיתה',
};
const NOTE_KIND: Record<string, 'info' | 'warn' | 'bad'> = { info: 'info', warning: 'warn', high: 'bad' };
const NOTE_TYPE: Record<string, string> = { condition: 'תנאי התאמה', difficulty: 'קושי באיתור', attention: 'שים לב', clarification: 'נדרש בירור' };

export default function TopicPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { catalog, loading, error, reload, topicById, sourceCounts } = useCatalog();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) || 'conditions');
  if (loading) return <Loading />;
  if (error || !catalog) return <ErrorBox error={error ?? 'לא ניתן לטעון'} retry={reload} />;
  const topic = id ? topicById.get(id) : undefined;
  if (!topic) return <div className="card empty"><p>הנושא לא נמצא, או שהוסר מפרסום.</p><Link to="/">חזרה לחיפוש</Link></div>;
  return <TopicView topic={topic} tab={tab} setTab={setTab} sources={sourceCounts[topic.id] ?? 0} />;
}

function TopicView({ topic, tab, setTab, sources }: { topic: Topic; tab: Tab; setTab: (t: Tab) => void; sources: number }) {
  const { catalog, topicById } = useCatalog();
  const age = ageText(topic);
  const sysLabels = topic.systems.map(s => catalog!.systems.find(x => x.id === s)?.label).filter(Boolean);
  const tagLabels = topic.tags.map(t => catalog!.tags.find(x => x.id === t)?.label ?? t);
  const activeNotes = topic.notes.filter(n => n.active);
  const critical = activeNotes.filter(n => n.severity !== 'info');
  const rest = activeNotes.filter(n => n.severity === 'info');

  return (
    <article>
      <p className="small"><Link to="/">← חזרה לחיפוש</Link></p>
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{topic.he}</h2>
          <PolicyBadge policy={topic.policy} />
        </div>
        {topic.en && <span className="en">{topic.en}</span>}
        <div className="row" style={{ marginBlockStart: 8 }}>
          <CoverageBadge topic={topic} />
          {topic.sourceMapped && <span className="badge neutral">מיפוי ראשוני מהמקורות, טרם נבדק סופית</span>}
          {topic.addedYear && <span className="badge info">נוסף למאגר השנה</span>}
        </div>
        <Notice kind="info" title="הבחנה מול אישור רשמי: ">זהו מצב הנושא במאגר ולא אישור פיקוח. תשובה אוטומטית היא תשובת התאמה לפי המאגר והנתונים שהוזנו. ההגשה הרשמית נעשית בטופס הקיים.</Notice>

        {/* התנאי הקריטי לפני הלשוניות, לא מוסתר בהן (סעיף 6.2) */}
        <div className="stack">
          {age && <Notice kind="warn" title="תנאי גיל: ">{age}.</Notice>}
          {topic.policy === 'not_suitable' && <Notice kind="bad" title="לא מתאים לפי הכלל הנוכחי. ">אפשר לבקש חריג, אך אין בכך היתר אוטומטי.</Notice>}
          {topic.policy === 'needs_review' && <Notice kind="info" title="דורש בירור. ">התנאים לנושא זה טרם הוכרעו מקצועית. המערכת לא נותנת עליו תשובה חיובית ודאית.</Notice>}
          {critical.map(n => <Notice key={n.id} kind={NOTE_KIND[n.severity]} title={`${n.title}: `}>{n.text}</Notice>)}
          {topic.difficulty > 0 && <Notice kind="warn" title=""><DifficultyMark level={topic.difficulty} /> <span className="small">זהו מידע מעשי על קושי באיתור בלבד, ואינו תנאי פסילה.</span></Notice>}
        </div>
      </div>

      <Tabs<Tab> tabs={[{ id: 'conditions', label: 'תנאים והערות' }, { id: 'check', label: 'בדיקת התאמה' }, { id: 'sources', label: `איתור מטופלים${sources ? ` (${sources})` : ''}` }]} value={tab} onChange={setTab} />

      {tab === 'conditions' && (
        <div className="stack">
          {topic.sourceCondition && (
            <div className="card"><h3 style={{ marginBlockStart: 0 }}>מה כתוב במקור</h3><p>{topic.sourceCondition}</p>
              {topic.reviewNote && <><h3>נקודות לבירור</h3><p>{topic.reviewNote}</p></>}
              <p className="small muted">מקור: מסמכי התוכנית, עמודים <bdi>{topic.sourcePages || 'לא צוין'}</bdi>. ניסוח המקור הוא מידע שנשמר כפי שהוא; כללי הבדיקה המחושבים מוצגים בלשונית "בדיקת התאמה".</p></div>
          )}
          {rest.map(n => <div className="card" key={n.id}><b>{NOTE_TYPE[n.type]}: {n.title}</b><p>{n.text}</p></div>)}
          <div className="card">
            <h3 style={{ marginBlockStart: 0 }}>פרטים משלימים</h3>
            <ul className="tight">
              {sysLabels.length > 0 && <li>מערכות: {sysLabels.join(', ')}</li>}
              {tagLabels.length > 0 && <li>תגיות: {tagLabels.join(', ')}</li>}
              {topic.aliases.length > 0 && <li>שמות חלופיים: {topic.aliases.map((a, i) => <span key={a}>{i > 0 && ', '}<bdi>{a}</bdi></span>)}</li>}
              <li>עודכן לאחרונה: {fmtDate(topic.updatedAt)} (גרסה {topic.version})</li>
              {topic.systemsNeedReview && <li className="muted">שיוך המערכת טרם הוכרע במלואו.</li>}
            </ul>
            {topic.relations.length > 0 && (
              <><h3>נושאים קשורים</h3><ul className="tight">{topic.relations.map((r, i) => {
                const t = topicById.get(r.targetId);
                return <li key={i}>{REL_LABEL[r.type]}: {t ? <Link to={`/topic/${t.id}`}>{t.he}</Link> : r.targetId}{r.note && <span className="muted small"> ({r.note})</span>}</li>;
              })}</ul></>
            )}
          </div>
          <ActionsCard topic={topic} onPick={setTab} />
        </div>
      )}

      {tab === 'check' && (
        <CaseCheckTab topic={topic} />
      )}
      {tab === 'sources' && <SourcesPanel topicId={topic.id} topicHe={topic.he} />}
    </article>
  );
}

function CaseCheckTab({ topic }: { topic: Topic }) {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog } = useCatalog();
  const groups = useAsync(async () => (ctx.verified ? (await api.listMyGroups()).filter(g => g.topicId === topic.id && g.status !== 'cancelled') : []), [api, ctx.verified, topic.id]);
  const [gid, setGid] = useState('');
  const g = groups.data?.find(x => x.id === gid) ?? groups.data?.[0];
  return (
    <div className="stack">
      <CaseCheck
        topic={topic} general={catalog!.generalRules} policyLabel={POLICY_LABEL[topic.policy]} officialFormUrl={catalog!.settings.officialFormUrl}
        groupInfo={g ? { count: g.studentCount, declared: g.casesDeclared, label: `${g.studentCount} תלמידים` } : undefined}
        onDeclare={g ? async n => { await api.declareCases(g.id, n); groups.reload(); } : undefined}
      />
      {(groups.data?.length ?? 0) > 1 && (
        <label className="field"><span className="lbl">קבוצה לדיווח</span>
          <select value={g?.id ?? ''} onChange={e => setGid(e.target.value)}>{groups.data!.map((x, i) => <option key={x.id} value={x.id}>קבוצה {i + 1} ({x.studentCount} תלמידים)</option>)}</select></label>
      )}
    </div>
  );
}

function ActionsCard({ topic, onPick }: { topic: Topic; onPick: (t: Tab) => void }) {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog } = useCatalog();
  const contact = useAsync(async () => api.getContact(), [api, ctx.verified]);
  const mailto = contact.data ? buildExceptionMailto({ responsibleEmail: contact.data.email }, topic.he) : null;
  return (
    <div className="card stack">
      <h3 style={{ marginBlockStart: 0 }}>מה עושים עכשיו?</h3>
      <div className="row">
        <button className="btn" onClick={() => onPick('check')}>בדיקת התאמה למקרה</button>
        <button className="btn secondary" onClick={() => onPick('sources')}>מקורות לאיתור מטופלים</button>
      </div>
      <SaveToGroup topic={topic} />
      <div>
        <b>בירור או חריג</b>
        <p className="small muted">חריג לגבי מטופל מסוים מטופל בפנייה אישית לאחראי, מחוץ לאתר. אל תכתבו באתר פרטים רפואיים או פרטי מקרה.</p>
        <div className="row">
          <Link className="btn secondary small" to={`/requests/inquiry?topic=${topic.id}`}>בירור כללי על הנושא</Link>
          {mailto ? <a className="btn secondary small" href={mailto}>פנייה אישית לאחראי בדוא״ל (כותרת כללית בלבד)</a>
            : <span className="small muted">{ctx.verified ? 'כתובת האחראי טרם הוגדרה.' : 'פרטי הקשר של האחראי מוצגים למשתמשים מחוברים.'}</span>}
          <a className="btn secondary small" href={catalog!.settings.officialFormUrl} target="_blank" rel="noopener noreferrer">הטופס הרשמי</a>
        </div>
        <p className="small muted">{catalog!.settings.submissionNote}</p>
      </div>
    </div>
  );
}

function SaveToGroup({ topic }: { topic: Topic }) {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog } = useCatalog();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [gid, setGid] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<DuplicateWarning[] | null>(null);
  const { busy, error, run } = useBusy();
  const groups = useAsync(async () => (ctx.verified ? (await api.listMyGroups()).filter(g => g.yearId === catalog!.settings.currentYearId && g.status !== 'cancelled') : []), [api, ctx.verified]);

  if (!ctx.user) return <p className="small"><Link to={`/login?next=/topic/${topic.id}`}>היכנסו</Link> כדי לשמור את הנושא לקבוצה.</p>;
  if (!ctx.verified) return <Notice kind="warn">יש לאמת את כתובת המייל כדי לשמור לקבוצה.</Notice>;

  async function check(g: Group) {
    const { histories, prevYearId, currentYearId } = await loadSchoolHistories(api, g.schoolId, catalog!.settings.currentYearId);
    return duplicateWarnings({ familyId: topic.familyId, ownGroupId: g.id, currentYearId, prevYearId, history: histories });
  }
  async function pick(id: string) {
    setGid(id); setWarn(null); setMsg(null);
    const g = groups.data?.find(x => x.id === id);
    if (g) setWarn(await run(() => check(g)) ?? null);
  }
  async function save() {
    const g = groups.data?.find(x => x.id === gid)!;
    const r = await run(() => api.setGroupTopic(g.id, { id: topic.id, familyId: topic.familyId, he: topic.he, version: topic.version }));
    if (r) setMsg(g.topicId && g.topicId !== topic.id ? 'הנושא הוחלף. פרטי התלמידים נשמרו ובדיקת הנושא נפתחה מחדש.' : 'הנושא נשמר לקבוצה.');
  }
  return (
    <div>
      <button className="btn secondary" onClick={() => setOpen(o => !o)} aria-expanded={open}>שמירה לקבוצה</button>
      {open && (
        <div className="card stack" style={{ marginBlockStart: 10 }}>
          {groups.loading && <Loading />}
          {groups.data && groups.data.length === 0 && <p>אין לכם קבוצות פעילות. <Link to="/groups">יצירת קבוצה</Link></p>}
          {groups.data && groups.data.length > 0 && (
            <>
              <label className="field"><span className="lbl">בחירת קבוצה</span>
                <select value={gid} onChange={e => pick(e.target.value)}>
                  <option value="">בחרו…</option>
                  {groups.data.map((g, i) => <option key={g.id} value={g.id}>קבוצה {i + 1}: {g.studentCount} תלמידים{g.topicId ? ` (כעת: ${catalog!.topics.find(t => t.id === g.topicId)?.he ?? g.topicId})` : ''}</option>)}
                </select></label>
              {warn && warn.map((w, i) => <DupNotice key={i} w={w} />)}
              <button className="btn" disabled={!gid || busy} onClick={save}>{busy ? 'שומר…' : 'שמירת הנושא בקבוצה'}</button>
            </>
          )}
          {msg && <Notice kind="ok"><span role="status">{msg}</span> <button className="linkbtn" onClick={() => nav('/groups')}>לקבוצות שלי</button></Notice>}
          {error && <p className="err" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function DupNotice({ w }: { w: DuplicateWarning }) {
  if (w.kind === 'prev_year_done') return <Notice kind="warn" title="שימו לב: ">נושא ממשפחה זהה (״{w.topicHe}״) בוצע במוסד בשנה הקודמת. לפי ההנחיות אין לבחור נושא שבוצע בשנה הקודמת. אפשר לפנות לאחראי להחלטה מיוחדת. השמירה אינה נחסמת.</Notice>;
  if (w.kind === 'same_cycle') return <Notice kind="warn" title="שימו לב: ">כבר נבחר נושא ממשפחה זהה (״{w.topicHe}״) במוסד באותו מחזור. לא מאשרים בדרך כלל יותר מקבוצה אחת בנושא זהה. יש לתאם עם עמיתיכם או לפנות לאחראי.</Notice>;
  if (w.kind === 'earlier_years_info') return <Notice kind="info">נושא ממשפחה זהה בוצע במוסד בשנה {w.yearId}. זה אינו חוסם: ההיסטוריה משמשת לצפייה ולרצף.</Notice>;
  return <Notice kind="info" title="אין היסטוריה מלאה למוסד. ">לא נמצאה היסטוריה לשנה הקודמת. אם נבחר בה אותו נושא במוסד, ההצהרה היא באחריות המורה. הרכז יכול להשלים את ההיסטוריה.</Notice>;
}

void En;
