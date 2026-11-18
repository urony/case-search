import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { NO_SYSTEM, searchTopics } from '../../domain/search';
import { academicYear } from '../../domain/years';
import type { Catalog, Policy, Topic } from '../../domain/types';
import { DifficultyMark, En, ErrorBox, fmtDate, Loading, Notice } from '../components';
import { useCatalog, useRT } from '../ctx';
import { SuggestForm } from './SuggestForm';
import { conditionSnippet, StatusBadge, TopicBody, V1_LABEL } from './TopicBody';


/** הודעות מצב העותק הציבורי: לא מציגים מידע ישן כאילו עודכן */
export function FreshnessNotice({ catalog }: { catalog: Catalog }) {
  const { mode } = useRT();
  if (catalog.stale) return <Notice kind="warn" title="לא ניתן היה לרענן את המידע. ">מוצג עותק שנשמר בדפדפן זה ועודכן לאחרונה ב־{fmtDate(catalog.generatedAt)}. ייתכן שהוא אינו עדכני.</Notice>;
  if (mode === 'service' && catalog.origin === 'bundled') return <Notice kind="warn" title="לא ניתן לטעון את המידע המעודכן. ">מוצג עותק מובנה של הרשימה, שייתכן שאינו כולל עדכונים אחרונים. נסו לרענן בעוד כמה דקות.</Notice>;
  if (mode === 'bundled') return <Notice kind="info" title="עותק מובנה. ">האתר פועל כעת ללא שירות נתונים, והמידע מוצג מקובץ מובנה (מיפוי ראשוני של המקורות). מקורות לאיתור ו"מה נוסף השנה" אינם זמינים בעותק זה.</Notice>;
  return null;
}

function ResultCard({ topic, via, approx, sources }: { topic: Topic; via?: string; approx?: boolean; sources: number }) {
  const snip = conditionSnippet(topic);
  return (
    <Link className="card topic-card" to={`/topic/${topic.id}`}>
      <div className="row between">
        <span className="title">{topic.he}</span>
        <StatusBadge policy={topic.policy} />
      </div>
      {topic.en && <span className="en">{topic.en}</span>}
      {via && <div className="small muted">נמצא לפי השם החלופי: <bdi>{via}</bdi></div>}
      {approx && <div className="small muted">התאמה משוערת. בדקו שזה הנושא שחיפשתם.</div>}
      {snip && <div className="small" style={{ marginBlockStart: 6 }}><b>{topic.policy === 'not_suitable' || topic.policy === 'needs_review' ? 'לפי המקור:' : 'תנאים:'}</b> {snip}</div>}
      {topic.policy === 'needs_review' && !snip && <div className="small" style={{ marginBlockStart: 6 }}>התנאים טרם הוכרעו. יש לברר מול הפיקוח.</div>}
      <div className="meta">
        {topic.difficulty > 0 && <DifficultyMark level={topic.difficulty} />}
        {sources > 0 && <span className="badge info">{sources} מקורות לאיתור</span>}
      </div>
    </Link>
  );
}

export function PublicHome() {
  const { catalog, loading, error, reload, index, sourceCounts } = useCatalog();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const system = params.get('system') ?? '';
  const status = (params.get('status') ?? '') as Policy | '';
  const all = params.get('all') === '1';
  const [draft, setDraft] = useState(q);
  const [sysOpen, setSysOpen] = useState(false);

  const hits = useMemo(() => searchTopics(index, q, { system: system || undefined, policy: status }, sourceCounts), [index, q, system, status, sourceCounts]);
  const main = hits.filter(h => h.match !== 'approx');
  const approx = hits.filter(h => h.match === 'approx');
  const sysCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of catalog?.topics ?? []) if (t.publish === 'published') { if (t.systems.length === 0) m[NO_SYSTEM] = (m[NO_SYSTEM] ?? 0) + 1; for (const s of t.systems) m[s] = (m[s] ?? 0) + 1; }
    return m;
  }, [catalog]);

  function setP(patch: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p);
  }
  if (loading) return <Loading text="טוען את רשימת הנושאים…" />;
  if (error || !catalog) return <ErrorBox error={error ?? 'לא ניתן לטעון את המידע.'} retry={reload} />;

  const newCount = (catalog.newItems ?? []).filter(n => n.yearId === catalog.settings.currentYearId).length;
  const sysLabel = system === NO_SYSTEM ? 'כללי או ללא שיוך למערכת' : catalog.systems.find(s => s.id === system)?.label;
  const searching = !!(q || system || status || all);

  return (
    <>
      <section className="hero">
        <h2>איזה נושא תרצו לבדוק?</h2>
        <p className="muted" style={{ marginBlockStart: -4 }}>בדקו אם מחלה או מצב רפואי יכולים לשמש נושא לעבודת גמר, עוד לפני שמחפשים מטופלים.</p>
        <form className="searchbox" onSubmit={e => { e.preventDefault(); setP({ q: draft.trim() || null, all: null }); }} role="search">
          <label className="sr-only" htmlFor="q">חיפוש נושא רפואי</label>
          <input id="q" type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder="שם מחלה או מצב, בעברית או באנגלית" autoComplete="off" />
          <button className="btn" type="submit">חיפוש</button>
        </form>
        <div className="row bigactions">
          <button type="button" className="btn secondary" aria-expanded={sysOpen} aria-controls="syspanel" onClick={() => setSysOpen(o => !o)}>מערכות הגוף {sysOpen ? '▴' : '▾'}</button>
          <Link className="btn newbtn" to="/new-this-year">מה נוסף השנה{newCount > 0 ? ` (${newCount})` : ''}</Link>
        </div>
      </section>

      {sysOpen && (
        <div id="syspanel" className="card syspanel" role="group" aria-label="מערכות הגוף">
          {[...catalog.systems, { id: NO_SYSTEM, label: 'כללי או ללא שיוך למערכת' }].filter(s => sysCount[s.id]).map(s => (
            <button key={s.id} type="button" className={`chip ${system === s.id ? 'on' : ''}`} aria-pressed={system === s.id}
              onClick={() => { setP({ system: system === s.id ? null : s.id, all: null }); setSysOpen(false); }}>{s.label} <span className="muted">({sysCount[s.id]})</span></button>
          ))}
        </div>
      )}

      <FreshnessNotice catalog={catalog} />
      <Notice kind="warn" title="חשוב: ">האתר מציג את מצב הנושא לפי הרשימה הקיימת. זה אינו אישור פיקוח סופי ואינו אישור של מטופל מסוים.</Notice>

      {searching && (
        <div className="row" aria-label="סינון">
          {sysLabel && <button type="button" className="chip on" onClick={() => setP({ system: null })}>מערכת: {sysLabel} ✕</button>}
          <label className="row small">מעמד:
            <select aria-label="סינון לפי מעמד" value={status} onChange={e => setP({ status: e.target.value || null })} style={{ inlineSize: 'auto' }}>
              <option value="">הכול</option>
              {(Object.keys(V1_LABEL) as Policy[]).map(k => <option key={k} value={k}>{V1_LABEL[k]}</option>)}
            </select></label>
          {(q || system || status || all) && <button type="button" className="linkbtn small" onClick={() => { setDraft(''); setParams(new URLSearchParams()); }}>ניקוי</button>}
        </div>
      )}

      {!searching && (
        <div className="card empty">
          <p>הקלידו שם מחלה בשדה החיפוש, או בחרו מערכת גוף.</p>
          <button type="button" className="btn secondary small" onClick={() => setP({ all: '1' })}>הצגת כל הנושאים ({catalog.topics.filter(t => t.publish === 'published').length})</button>
        </div>
      )}

      {searching && (
        <>
          <h3 aria-live="polite">{main.length === 1 ? 'תוצאה אחת' : `${main.length} תוצאות`}{q ? ` עבור ״${q}״` : ''}{sysLabel ? ` במערכת ${sysLabel}` : ''}</h3>
          {main.length === 0 && approx.length === 0 && <div className="card empty"><p>לא נמצאו נושאים. נסו ניסוח אחר, שם באנגלית או קיצור.</p><p className="small muted">נושא שאינו ברשימה אינו בהכרח מאושר או לא מאושר: יש לברר מול הפיקוח.</p></div>}
          <div className="grid">{main.slice(0, 80).map(h => <ResultCard key={h.topic.id} topic={h.topic} via={h.via} sources={sourceCounts[h.topic.id] ?? 0} />)}</div>
          {main.length > 80 && <p className="muted">מוצגות 80 התוצאות הראשונות. צמצמו את החיפוש כדי לראות עוד.</p>}
          {approx.length > 0 && (
            <>
              <h3>התכוונתם ל…?</h3>
              <div className="grid">{approx.slice(0, 6).map(h => <ResultCard key={h.topic.id} topic={h.topic} via={h.via} approx sources={sourceCounts[h.topic.id] ?? 0} />)}</div>
            </>
          )}
        </>
      )}
      <p className="muted small" style={{ marginBlockStart: 24 }}>הסימון <En>▲</En> מציין קושי באיתור מטופלים בלבד. הוא אינו תנאי פסילה.</p>
    </>
  );
}

export function PublicTopic() {
  const { id } = useParams();
  const { catalog, loading, error, reload, topicById } = useCatalog();
  if (loading) return <Loading />;
  if (error || !catalog) return <ErrorBox error={error ?? 'לא ניתן לטעון'} retry={reload} />;
  const topic = id ? topicById.get(id) : undefined;
  if (!topic || topic.publish !== 'published') return <div className="card empty"><p>הנושא לא נמצא, או שהוסר מפרסום.</p><Link to="/">חזרה לחיפוש</Link></div>;
  const general = catalog.generalRules.rules.find(r => r.status === 'published')?.teacherText;
  return (
    <>
      <p className="small"><Link to="/">← חזרה לחיפוש</Link></p>
      <FreshnessNotice catalog={catalog} />
      <TopicBody topic={topic} systems={catalog.systems} generalText={general} sources={catalog.sources?.[topic.id] ?? []} suggest={<SuggestForm topicId={topic.id} topicHe={topic.he} />} />
    </>
  );
}

export function WhatsNew() {
  const { catalog, loading, error, reload, topicById } = useCatalog();
  const [year, setYear] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !catalog) return <ErrorBox error={error ?? 'לא ניתן לטעון'} retry={reload} />;
  const items = catalog.newItems ?? [];
  const cur = catalog.settings.currentYearId;
  const years = Array.from(new Set([cur, ...items.map(i => i.yearId)])).sort().reverse();
  const y = year ?? cur;
  const label = (id: string) => catalog.years.find(x => x.id === id)?.label ?? academicYear(parseInt(id, 10)).label;
  const shown = items.filter(i => i.yearId === y);
  return (
    <div className="stack">
      <h2>מה נוסף השנה</h2>
      <FreshnessNotice catalog={catalog} />
      {years.length > 1 && (
        <label className="field" style={{ maxInlineSize: 260 }}><span className="lbl">שנת לימודים</span>
          <select value={y} onChange={e => setYear(e.target.value)}>{years.map(id => <option key={id} value={id}>{label(id)} ({id})</option>)}</select></label>
      )}
      <p className="muted small">כאן מופיעים נושאים שנוספו למאגר ועדכונים מהותיים שמנהל האתר בחר לפרסם. שינוי קטן, כמו תיקון כתיב, אינו מופיע.</p>
      {shown.length === 0
        ? <div className="card empty">עדיין לא נוספו נושאים חדשים לשנה זו.</div>
        : <div className="grid">{shown.map(i => {
          const t = i.topicId ? topicById.get(i.topicId) : undefined;
          return (
            <div className="card" key={i.id}>
              <div className="row between">
                <b>{t && t.publish === 'published' ? <Link to={`/topic/${t.id}`}>{i.title}</Link> : i.title}</b>
                {t && t.publish === 'published' && <StatusBadge policy={t.policy} />}
              </div>
              <p>{i.text}</p>
              <p className="small muted">שנת {label(i.yearId)} · פורסם {fmtDate(i.publishedAt)}</p>
            </div>
          );
        })}</div>}
    </div>
  );
}

export function PublicAbout() {
  const { catalog } = useCatalog();
  return (
    <div className="stack">
      <h2>על הכלי</h2>
      <div className="card stack">
        <p><b>מה הכלי עושה.</b> עוזר לתלמידים ולמורים לבדוק אם מחלה או מצב רפואי יכולים לשמש נושא לעבודת גמר במערכות רפואיות, עוד לפני שמחפשים מטופלים: אפשר לחפש לפי שם (בעברית, באנגלית, בקיצור או בשם חלופי), או לעיין לפי מערכת גוף.</p>
        <p><b>מה הכלי אינו.</b> הוא אינו אישור פיקוח, אינו מנפיק אישור, ואינו בודק או מאשר מטופל מסוים. בחירת מטופלים והגשת הנושא כפופות להנחיות ולאישור הפיקוח, והגשה רשמית נעשית בדרך הקיימת.</p>
        <p><b>מקור המידע.</b> הרשימה מבוססת על מסמכי התוכנית. כאשר המקורות סותרים או אינם ברורים, הנושא מסומן ״דורש בירור״ ולא נקבע עבורו מעמד.</p>
        <p><b>פרטיות.</b> האתר אינו מבקש פרטים אישיים מהמבקרים, ואין בו פרטי תלמידים או מטופלים. החיפוש מתבצע בדפדפן שלכם ואינו נשלח לשום מקום.</p>
        {catalog?.settings.submissionNote && <p><b>מועד הגשה.</b> {catalog.settings.submissionNote}</p>}
        {catalog?.settings.officialFormUrl && <p><a href={catalog.settings.officialFormUrl} target="_blank" rel="noopener noreferrer">לטופס הרשמי (נפתח בחלון חדש)</a></p>}
      </div>
      <div className="card">
        <b>מקרא המעמדים</b>
        <ul className="plain stack">
          <li><StatusBadge policy="suitable" /> הנושא מופיע ברשימה הרשמית כמאושר.</li>
          <li><StatusBadge policy="conditional" /> הנושא מאושר רק בתנאים המפורטים בכרטיס.</li>
          <li><StatusBadge policy="not_suitable" /> לפי הרשימה הרשמית הנושא אינו מאושר.</li>
          <li><StatusBadge policy="needs_review" /> המקורות אינם ברורים או סותרים. אין תשובה ודאית, ויש לברר מול הפיקוח. זו אינה פסילה.</li>
        </ul>
        <p className="small muted">הסימון <En>▲</En> מציין קושי באיתור מטופלים, והוא מידע מעשי בלבד.</p>
      </div>
    </div>
  );
}
