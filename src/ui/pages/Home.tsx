import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { searchTopics, SearchFilters } from '../../domain/search';
import type { Topic } from '../../domain/types';
import { CoverageBadge, DifficultyMark, En, ErrorBox, Loading, Notice, PolicyBadge } from '../components';
import { useCatalog, useRT } from '../ctx';

const EXAMPLES = ['התקף לב', 'COPD', 'סוכרת נעורים', 'Celiac', 'אסתמה', 'לופוס'];

export function ageText(t: Topic): string | null {
  if (t.ageMin !== null && t.ageMax !== null) return `גיל ${t.ageMin}–${t.ageMax} כולל`;
  if (t.ageMax !== null) return `עד גיל ${t.ageMax} כולל`;
  if (t.ageMin !== null) return `מגיל ${t.ageMin} ומעלה`;
  return null;
}

export function TopicCard({ topic, sources, via, approx }: { topic: Topic; sources: number; via?: string; approx?: boolean }) {
  const { catalog } = useCatalog();
  const age = ageText(topic);
  const resultNotes = topic.notes.filter(n => n.active && n.showInResults);
  const sys = topic.systems.map(id => catalog?.systems.find(s => s.id === id)?.label).filter(Boolean);
  const hasRestrictions = !!age || resultNotes.length > 0 || (topic.sourceCondition && topic.policy !== 'not_suitable');
  return (
    <Link className="card topic-card" to={`/topic/${topic.id}`}>
      <div className="row between">
        <span className="title">{topic.he}</span>
        <PolicyBadge policy={topic.policy} />
      </div>
      {topic.en && <span className="en">{topic.en}</span>}
      {via && <div className="small muted">נמצא לפי השם החלופי: <bdi>{via}</bdi></div>}
      {approx && <div className="small muted">התאמה משוערת. בדקו שזה הנושא שחיפשתם.</div>}
      {age && <div style={{ marginBlockStart: 6 }}><b>תנאי מרכזי:</b> {age}</div>}
      {hasRestrictions && (
        <div className="small" style={{ marginBlockStart: 4 }}>
          <b>שימו לב להגבלות:</b>{' '}
          {resultNotes.length ? resultNotes.map(n => n.title).join(' · ') : (topic.sourceCondition.length > 110 ? topic.sourceCondition.slice(0, 110) + '…' : topic.sourceCondition)}
        </div>
      )}
      <div className="meta">
        {sys.slice(0, 2).map(s => <span key={s} className="badge neutral">{s}</span>)}
        <CoverageBadge topic={topic} />
        {topic.sourceMapped && <span className="badge neutral">מיפוי ראשוני, טרם נבדק סופית</span>}
        {topic.addedYear && <span className="badge info">נוסף השנה</span>}
        {topic.difficulty > 0 && <DifficultyMark level={topic.difficulty} />}
        {sources > 0 && <span className="badge info">{sources} מקורות איתור</span>}
      </div>
    </Link>
  );
}

export default function Home() {
  const { catalog, loading, error, reload, index, sourceCounts } = useCatalog();
  const { mode } = useRT();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [age, setAge] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const active: SearchFilters = { ...filters, age: age.trim() === '' ? null : Number(age), system: params.get('system') ?? filters.system };
  const hits = useMemo(() => searchTopics(index, q, active, sourceCounts), [index, q, filters, age, params, sourceCounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const approx = hits.filter(h => h.match === 'approx');
  const main = hits.filter(h => h.match !== 'approx');
  const anyFilter = !!(active.system || active.tag || active.policy || active.difficulty !== undefined && active.difficulty !== '' || active.hasSources || active.newInYear || active.age !== null && active.age !== undefined);

  function submit(e: React.FormEvent) { e.preventDefault(); const p = new URLSearchParams(params); if (draft.trim()) p.set('q', draft.trim()); else p.delete('q'); setParams(p); }
  function setSystem(id: string) { const p = new URLSearchParams(params); if (id) p.set('system', id); else p.delete('system'); setParams(p); }
  function pickExample(x: string) { setDraft(x); const p = new URLSearchParams(params); p.set('q', x); setParams(p); }

  if (loading) return <Loading text="טוען את מאגר הנושאים…" />;
  if (error || !catalog) return <ErrorBox error={error ?? 'לא ניתן לטעון את המאגר.'} retry={reload} />;
  const yearId = catalog.settings.currentYearId;

  return (
    <>
      <section className="hero">
        <h2>איזה נושא תרצו לבדוק?</h2>
        <form className="searchbox" onSubmit={submit} role="search">
          <label className="sr-only" htmlFor="q">חיפוש נושא רפואי</label>
          <input id="q" type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder="שם מחלה או מצב, בעברית או באנגלית" autoComplete="off" />
          <button className="btn" type="submit">חיפוש</button>
        </form>
        <div className="chips" aria-label="דוגמאות לחיפוש">
          {EXAMPLES.map(x => <button key={x} type="button" className="chip" onClick={() => pickExample(x)}><bdi>{x}</bdi></button>)}
        </div>
        <div className="chips" aria-label="עיון לפי מערכות גוף">
          <button type="button" className={`chip ${!active.system ? 'on' : ''}`} onClick={() => setSystem('')}>כל המערכות</button>
          {catalog.systems.map(s => <button key={s.id} type="button" className={`chip ${active.system === s.id ? 'on' : ''}`} onClick={() => setSystem(active.system === s.id ? '' : s.id)}>{s.label}</button>)}
        </div>
        <p className="row" style={{ justifyContent: 'center', marginBlockStart: 14 }}>
          <Link to="/new-this-year">נושאים חדשים השנה</Link> <span aria-hidden="true">·</span> <Link to="/history">היסטוריית נושאים של מוסד</Link>
          <span aria-hidden="true">·</span> <button type="button" className="linkbtn" onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters}>סינון מתקדם</button>
        </p>
      </section>

      {mode === 'bundled' && <Notice kind="info" title="מצב ללא שירות נתונים: ">התוכן מוצג מקובץ מובנה (מיפוי ראשוני מהמקורות), בקריאה בלבד. כניסה ושמירה אינן זמינות.</Notice>}
      <Notice kind="warn" title="חשוב: ">כלי זה בודק התאמה לפי המאגר והנתונים שהוזנו, ואינו אישור פיקוח רשמי. ההגשה הרשמית נעשית בטופס הקיים.</Notice>

      {showFilters && (
        <div className="card grid cols2" aria-label="מסננים">
          <label className="field"><span className="lbl">תגית</span>
            <select value={filters.tag ?? ''} onChange={e => setFilters(f => ({ ...f, tag: e.target.value || undefined }))}>
              <option value="">הכול</option>{catalog.tags.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select></label>
          <label className="field"><span className="lbl">מעמד התאמה</span>
            <select value={filters.policy ?? ''} onChange={e => setFilters(f => ({ ...f, policy: (e.target.value || '') as SearchFilters['policy'] }))}>
              <option value="">הכול</option><option value="suitable">מתאים כנושא</option><option value="conditional">מתאים בתנאים</option>
              <option value="needs_review">דורש בירור</option><option value="not_suitable">לא מתאים לפי הכלל הנוכחי</option>
            </select></label>
          <label className="field"><span className="lbl">גיל מתאים לפי טווחי המאגר</span>
            <input type="number" min={0} max={120} value={age} onChange={e => setAge(e.target.value)} autoComplete="off" />
            <span className="help">לצורך סינון בלבד. הגיל אינו נשמר ואינו נשלח.</span></label>
          <label className="field"><span className="lbl">קושי באיתור</span>
            <select value={String(filters.difficulty ?? '')} onChange={e => setFilters(f => ({ ...f, difficulty: e.target.value === '' ? '' : (Number(e.target.value) as 0 | 1 | 2) }))}>
              <option value="">הכול</option><option value="0">ללא סימון</option><option value="1">מאתגר</option><option value="2">מאתגר מאוד</option>
            </select></label>
          <label className="row"><input type="checkbox" checked={!!filters.hasSources} onChange={e => setFilters(f => ({ ...f, hasSources: e.target.checked }))} /> קיימים מקורות איתור</label>
          <label className="row"><input type="checkbox" checked={filters.newInYear === yearId} onChange={e => setFilters(f => ({ ...f, newInYear: e.target.checked ? yearId : undefined }))} /> נוסף השנה</label>
          <div><button className="btn secondary small" onClick={() => { setFilters({}); setAge(''); setSystem(''); }}>נקה מסננים</button></div>
        </div>
      )}

      <h3 aria-live="polite">{q || anyFilter ? `${main.length} תוצאות${q ? ` עבור ״${q}״` : ''}` : `כל הנושאים (${main.length})`}</h3>
      {main.length === 0 && approx.length === 0 && (
        <div className="card empty">
          <p>לא נמצאו נושאים. נסו ניסוח אחר, שם באנגלית או קיצור.</p>
          <p>אם הנושא אינו במאגר, אפשר <Link to="/requests/new-topic">להציע נושא חדש</Link>.</p>
        </div>
      )}
      <div className="grid">
        {main.slice(0, 80).map(h => <TopicCard key={h.topic.id} topic={h.topic} sources={sourceCounts[h.topic.id] ?? 0} via={h.via} />)}
      </div>
      {main.length > 80 && <p className="muted">מוצגות 80 התוצאות הראשונות. צמצמו את החיפוש כדי לראות עוד.</p>}
      {approx.length > 0 && (
        <>
          <h3>התכוונתם ל…?</h3>
          <div className="grid">{approx.slice(0, 6).map(h => <TopicCard key={h.topic.id} topic={h.topic} sources={sourceCounts[h.topic.id] ?? 0} via={h.via} approx />)}</div>
        </>
      )}
      <p className="muted small" style={{ marginBlockStart: 24 }}>הסימון <En>▲</En> מציין קושי באיתור מטופלים בלבד. הוא אינו תנאי פסילה ואינו משנה את תוצאת ההתאמה.</p>
    </>
  );
}
