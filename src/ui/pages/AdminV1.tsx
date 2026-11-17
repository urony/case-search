import { useState } from 'react';
import { Link } from 'react-router-dom';
import { academicYear } from '../../domain/years';
import type { NewItem, SourceKind } from '../../domain/types';
import { checkSourceInput, SOURCE_KINDS, SourceInput } from '../../domain/helpers';
import { Field, fmtDate, Loading, Notice, useAsync, useBusy, ErrorBox } from '../components';
import { useCatalog, useRT } from '../ctx';
import { StatusBadge } from '../v1/TopicBody';

/** פרסום: מה ישתנה לציבור, ופעולת פרסום אחת. אם הפרסום נכשל, ההודעה מוצגת כאן והעותק הציבורי נשאר כפי שהיה. */
export function PublishAdmin() {
  const { api } = useRT();
  const { reload } = useCatalog();
  const d = useAsync(() => api.adminPublishDiff(), [api]);
  const { busy, error, run } = useBusy();
  const [done, setDone] = useState<string | null>(null);
  if (d.loading) return <Loading text="בודק מה השתנה מאז הפרסום האחרון…" />;
  if (d.error || !d.data) return <ErrorBox error={d.error ?? ''} retry={d.reload} />;
  const x = d.data;
  const list = (title: string, l: { added: string[]; removed: string[]; changed: string[] }) => (l.added.length + l.removed.length + l.changed.length > 0) && (
    <div className="card">
      <b>{title}</b>
      {l.added.length > 0 && <p className="small"><span className="badge ok">נוספו</span> {l.added.join(' · ')}</p>}
      {l.changed.length > 0 && <p className="small"><span className="badge warn">שונו</span> {l.changed.join(' · ')}</p>}
      {l.removed.length > 0 && <p className="small"><span className="badge bad">יוסרו מהתצוגה הציבורית</span> {l.removed.join(' · ')}</p>}
    </div>
  );
  async function publish() {
    if (!confirm('הפרסום מעדכן מיד את מה שתלמידים ומורים רואים באתר. לפרסם?')) return;
    setDone(null);
    const r = await run(() => api.publishCatalog());
    if (r) { setDone(`פורסם ואומת: ${r.topics} נושאים, ${r.sources} מקורות לאיתור; פריטים ב״מה נוסף השנה״: ${r.newItems} (${fmtDate(r.generatedAt)}).`); reload(); d.reload(); }
  }
  return (
    <div className="stack">
      <h2>פרסום לציבור</h2>
      <p className="muted small">עריכות נשמרות במאגר הראשי ואינן נראות לציבור עד שמפרסמים כאן (או בכפתור "שמירה ופרסום" בעורך נושא). הפרסום יוצר עותק ציבורי מהיר, ללא פרטים פנימיים.</p>
      {x.published
        ? <p>הפרסום האחרון: <b>{fmtDate(x.liveGeneratedAt!)}</b>.</p>
        : <Notice kind="warn" title="טרם פורסם עותק ציבורי. ">עד הפרסום הראשון האתר מציג עותק מובנה של הרשימה (מיפוי ראשוני), ללא מקורות לאיתור וללא "מה נוסף השנה".</Notice>}
      {x.upToDate
        ? <Notice kind="ok" title="הכול מפורסם. ">אין שינויים שממתינים לפרסום.</Notice>
        : <Notice kind="warn" title="יש שינויים שטרם פורסמו. ">הציבור רואה כרגע את המצב הקודם.</Notice>}
      {list('נושאים', x.topics)}
      {(x.sources.added + x.sources.removed + x.sources.changed) > 0 && <div className="card"><b>מקורות לאיתור</b><p className="small">נוספו {x.sources.added} · שונו {x.sources.changed} · יוסרו {x.sources.removed}</p></div>}
      {list('מה נוסף השנה', x.newItems)}
      {x.otherChanged && x.published && <div className="card"><b>הגדרות</b><p className="small">שונו הגדרות כלליות, מילוני מערכות או שנות לימוד.</p></div>}
      <div className="row">
        <button className="btn" disabled={busy || (x.upToDate && x.published)} onClick={publish}>{busy ? 'מפרסם…' : 'פרסום עכשיו'}</button>
        <button className="btn secondary" disabled={busy} onClick={d.reload}>בדיקה מחדש</button>
        <Link className="btn secondary" to="/" target="_blank">צפייה באתר כפי שהציבור רואה</Link>
      </div>
      {done && <Notice kind="ok"><span role="status">{done}</span></Notice>}
      {error && <Notice kind="bad" title="הפרסום נכשל. ">{error} העותק הציבורי לא שונה ונשאר כפי שהיה. השינויים שלכם נשמרו במאגר הראשי, ואפשר לנסות שוב.</Notice>}
      <p className="small muted">הציבור רואה פרסום חדש תוך עד 5 דקות (העותק נשמר בדפדפן של כל מבקר כדי לחסוך קריאות). המנהל רואה את השינוי מיד.</p>
    </div>
  );
}

/** עריכת "מה נוסף השנה": פריטים שהמנהל בחר לפרסם. אין יצירה אוטומטית מייבוא או משינוי קטן. */
export function WhatsNewAdmin() {
  const { api } = useRT();
  const { catalog } = useCatalog();
  const items = useAsync(() => api.adminListNewItems(), [api]);
  const topics = useAsync(() => api.adminListTopics(), [api]);
  const [form, setForm] = useState<{ id?: string; yearId: string; topicId: string; title: string; text: string; visible: boolean } | null>(null);
  const { busy, error, run } = useBusy();
  const [msg, setMsg] = useState<string | null>(null);
  if (!catalog) return <Loading />;
  const cur = catalog.settings.currentYearId;
  const label = (id: string) => catalog.years.find(x => x.id === id)?.label ?? academicYear(parseInt(id, 10)).label;
  const published = (topics.data ?? []).filter(t => t.publish === 'published').sort((a, b) => a.he.localeCompare(b.he, 'he'));
  const blank = () => ({ yearId: cur, topicId: '', title: '', text: '', visible: true });
  const edit = (i: NewItem) => setForm({ id: i.id, yearId: i.yearId, topicId: i.topicId ?? '', title: i.title, text: i.text, visible: i.visible });
  async function save() {
    const f = form!;
    const r = await run(() => api.adminSaveNewItem({ ...f, topicId: f.topicId || null }));
    if (r) { setForm(null); setMsg('נשמר. כדי שיופיע לציבור יש לפרסם.'); items.reload(); }
  }
  return (
    <div className="stack">
      <h2>מה נוסף השנה</h2>
      <p className="muted small">רשימה ציבורית של נושאים שנוספו ושל עדכונים מהותיים בלבד. מה שלא נוסף כאן לא יופיע. שינוי כתיב קטן אינו תוספת. אם אין פריטים, הציבור רואה: "עדיין לא נוספו נושאים חדשים לשנה זו".</p>
      <div><button className="btn" onClick={() => { setForm(blank()); setMsg(null); }}>פריט חדש</button></div>
      {msg && <Notice kind="ok"><span role="status">{msg}</span> <Link to="/admin/publish">לפרסום</Link></Notice>}
      {form && (
        <div className="card stack">
          <h3 style={{ marginBlockStart: 0 }}>{form.id ? 'עריכת פריט' : 'פריט חדש'}</h3>
          <div className="grid cols2">
            <Field label="שנת לימודים"><select value={form.yearId} onChange={e => setForm({ ...form, yearId: e.target.value })}>
              {Array.from(new Set([cur, ...catalog.years.map(y => y.id), form.yearId])).sort().reverse().map(id => <option key={id} value={id}>{label(id)} ({id})</option>)}</select></Field>
            <Field label="נושא קשור (לא חובה)" help="אם נבחר, הכרטיס יקשר לנושא ויציג את מעמדו."><select value={form.topicId} onChange={e => { const t = published.find(x => x.id === e.target.value); setForm({ ...form, topicId: e.target.value, title: form.title || t?.he || '' }); }}>
              <option value="">ללא נושא (עדכון כללי)</option>{published.map(t => <option key={t.id} value={t.id}>{t.he}</option>)}</select></Field>
          </div>
          <Field label="כותרת"><input type="text" maxLength={120} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="מה נוסף או השתנה (קצר)" help={`${form.text.length}/600`}><textarea maxLength={600} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></Field>
          <label className="row"><input type="checkbox" checked={form.visible} onChange={e => setForm({ ...form, visible: e.target.checked })} /> גלוי לציבור (בפרסום הבא)</label>
          <div><b>תצוגה מקדימה</b>
            <div className="card"><b>{form.title || 'כותרת'}</b><p>{form.text || 'מה נוסף או השתנה'}</p><p className="small muted">שנת {label(form.yearId)} · יפורסם בתאריך הפרסום</p></div></div>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="row"><button className="btn" disabled={busy} onClick={save}>{busy ? 'שומר…' : 'שמירה'}</button><button className="btn secondary" onClick={() => setForm(null)}>ביטול</button></div>
        </div>
      )}
      {items.loading && <Loading />}
      {items.error && <ErrorBox error={items.error} retry={items.reload} />}
      {items.data && items.data.length === 0 && <div className="card empty">אין עדיין פריטים.</div>}
      <div className="stack">{(items.data ?? []).map(i => {
        const t = i.topicId ? published.find(x => x.id === i.topicId) : undefined;
        return (
          <div className="card" key={i.id}>
            <div className="row between"><b>{i.title}</b><span>{t && <StatusBadge policy={t.policy} />} <span className={`badge ${i.visible ? 'ok' : 'neutral'}`}>{i.visible ? 'גלוי' : 'מוסתר'}</span></span></div>
            <p>{i.text}</p>
            <p className="small muted">שנת {label(i.yearId)} · {fmtDate(i.publishedAt)}</p>
            <div className="row">
              <button className="btn small secondary" onClick={() => edit(i)}>עריכה</button>
              <button className="btn small secondary" disabled={busy} onClick={() => run(() => api.adminSaveNewItem({ id: i.id, yearId: i.yearId, topicId: i.topicId, title: i.title, text: i.text, visible: !i.visible })).then(items.reload)}>{i.visible ? 'הסתרה' : 'הצגה'}</button>
              <button className="btn small danger" disabled={busy} onClick={() => { if (confirm('למחוק את הפריט לצמיתות?')) run(() => api.adminDeleteNewItem(i.id)).then(items.reload); }}>מחיקה</button>
            </div>
          </div>
        );
      })}</div>
    </div>
  );
}

/** הוספת מקור איתור בידי מנהל: ללא מכסה, מסומן כנבדק, מתפרסם לציבור בפרסום הבא. */
export function AdminAddSource({ onDone }: { onDone: () => void }) {
  const { api } = useRT();
  const topics = useAsync(() => api.adminListTopics(), [api]);
  const [f, setF] = useState<SourceInput>({ topicId: '', title: '', kind: 'association', text: '', url: '', phone: '', region: '', population: '', confirmNoPatientData: false });
  const { busy, error, run } = useBusy();
  const chk = checkSourceInput(f);
  const upd = (p: Partial<SourceInput>) => setF(s => ({ ...s, ...p }));
  const list = (topics.data ?? []).filter(t => t.publish === 'published').sort((a, b) => a.he.localeCompare(b.he, 'he'));
  return (
    <form className="card stack" onSubmit={async e => { e.preventDefault(); const r = await run(() => api.adminAddSource(f)); if (r) onDone(); }}>
      <h3 style={{ marginBlockStart: 0 }}>הוספת מקור לאיתור מטופלים</h3>
      <Notice kind="warn">אין להוסיף פרטי מטופל (שם, טלפון פרטי, מספר זהות, מייל או פרט רפואי). רק פרטי קשר של ארגון, אתר או קבוצה.</Notice>
      <Field label="נושא"><select required value={f.topicId} onChange={e => upd({ topicId: e.target.value })}><option value="">בחרו נושא…</option>{list.map(t => <option key={t.id} value={t.id}>{t.he}</option>)}</select></Field>
      <Field label="כותרת ברורה"><input type="text" required maxLength={120} value={f.title} onChange={e => upd({ title: e.target.value })} /></Field>
      <Field label="סוג המקור"><select value={f.kind} onChange={e => upd({ kind: e.target.value as SourceKind })}>{SOURCE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
      <Field label="הסבר (טקסט חופשי)" help={`${f.text.length}/1500`}><textarea maxLength={1500} value={f.text} onChange={e => upd({ text: e.target.value })} /></Field>
      <div className="grid cols2">
        <Field label="כתובת אתר (לא חובה)" help="http או https בלבד"><input type="text" dir="ltr" inputMode="url" value={f.url} onChange={e => upd({ url: e.target.value })} /></Field>
        <Field label="טלפון של הארגון (לא חובה)"><input type="tel" dir="ltr" value={f.phone} onChange={e => upd({ phone: e.target.value })} /></Field>
        <Field label="אזור בארץ (לא חובה)"><input type="text" maxLength={80} value={f.region} onChange={e => upd({ region: e.target.value })} /></Field>
        <Field label="אוכלוסייה מתאימה (לא חובה)"><input type="text" maxLength={120} value={f.population} onChange={e => upd({ population: e.target.value })} /></Field>
      </div>
      <label className="row"><input type="checkbox" checked={f.confirmNoPatientData} onChange={e => upd({ confirmNoPatientData: e.target.checked })} /> אני מאשר/ת שלא הוספתי פרטי מטופל</label>
      {chk.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
      {f.title && !chk.ok && chk.errors.map(m => <p className="err small" key={m}>{m}</p>)}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy || !chk.ok || !f.topicId}>{busy ? 'שומר…' : 'שמירת המקור'}</button></div>
    </form>
  );
}

/** תמונת מצב לגרסה הראשונה */
export function DashboardV1() {
  const { api } = useRT();
  const d = useAsync(async () => {
    const [topics, diff, items, sources] = await Promise.all([api.adminListTopics(), api.adminPublishDiff(), api.adminListNewItems(), api.adminListSources(false)]);
    return { topics, diff, items, sources };
  }, [api]);
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <ErrorBox error={d.error ?? ''} retry={d.reload} />;
  const { topics, diff, items, sources } = d.data;
  const pub = topics.filter(t => t.publish === 'published');
  const by = (p: string) => pub.filter(t => t.policy === p).length;
  const unchecked = pub.filter(t => t.sourceMapped).length;
  return (
    <div className="stack">
      <h2>תמונת מצב</h2>
      {diff.upToDate && diff.published
        ? <Notice kind="ok" title="הכול מפורסם. ">הפרסום האחרון: {fmtDate(diff.liveGeneratedAt!)}.</Notice>
        : <Notice kind="warn" title={diff.published ? 'יש שינויים שטרם פורסמו. ' : 'טרם פורסם עותק ציבורי. '}><Link to="/admin/publish">למסך הפרסום</Link></Notice>}
      <div className="kpi">
        <Link className="card" to="/admin/topics"><b>{pub.length}</b>נושאים מפורסמים</Link>
        <div className="card"><b>{by('suitable')}</b>מאושרים כנושא</div>
        <div className="card"><b>{by('conditional')}</b>מאושרים בתנאים</div>
        <div className="card"><b>{by('not_suitable')}</b>אינם מאושרים</div>
        <div className="card"><b>{by('needs_review')}</b>דורשים בירור</div>
        <Link className="card" to="/admin/topics"><b>{unchecked}</b>מיפוי ראשוני שטרם נבדק</Link>
        <Link className="card" to="/admin/sources"><b>{sources.filter(s => s.visible).length}</b>מקורות לאיתור</Link>
        <Link className="card" to="/admin/whats-new"><b>{items.filter(i => i.visible).length}</b>פריטים ב״מה נוסף השנה״</Link>
      </div>
      <div className="card stack">
        <b>איך מעדכנים</b>
        <ol className="tight">
          <li>עורכים נושא ("מחלות וכללים"), מקור איתור או פריט ב״מה נוסף השנה״.</li>
          <li>בודקים את התצוגה המקדימה בעורך הנושא.</li>
          <li>מפרסמים ב"פרסום לציבור". רק אז השינוי נראה לתלמידים ולמורים.</li>
        </ol>
      </div>
    </div>
  );
}
