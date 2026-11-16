import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SchoolYearHistory } from '../../domain/types';
import { academicYear } from '../../domain/years';
import { Field, Loading, Notice, useAsync, useBusy, ErrorBox } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';
import { HISTORY_STATE_LABEL, loadSchoolHistories } from '../history';

/** מסך רכז מגמה: קבוצות המוסד, ותיקון היסטוריית הנושאים של המוסד בלבד (סעיף 4.3) */
export default function Coordinator() {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog, topicById } = useCatalog();
  const schoolId = ctx.roleDoc?.schoolId;
  const groups = useAsync(async () => (schoolId ? api.listSchoolGroups(schoolId) : []), [api, schoolId]);
  const hist = useAsync(async () => (schoolId ? (await loadSchoolHistories(api, schoolId, catalog!.settings.currentYearId)).histories : []), [api, schoolId]);
  const [edit, setEdit] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  const [draft, setDraft] = useState<SchoolYearHistory | null>(null);
  const [newTopic, setNewTopic] = useState('');
  if (ctx.role !== 'coordinator' && ctx.role !== 'admin') return <Notice kind="bad">אזור זה מיועד לרכזי מגמה.</Notice>;
  if (!schoolId) return <Notice kind="info">חשבון המנהל אינו משויך למוסד. כניסה לרכז דורשת שיוך מוסדי.</Notice>;
  return (
    <div className="stack">
      <h2>רכז מגמה: המוסד שלי</h2>
      <p className="muted small">אתם רואים ומנהלים את הקבוצות הפעילות במוסדכם בלבד, ומתקנים את היסטוריית הנושאים של מוסדכם. אין גישה למוסדות אחרים או לעריכת מאגר המחלות.</p>
      <h3>קבוצות פעילות</h3>
      {groups.loading && <Loading />}
      {groups.error && <ErrorBox error={groups.error} retry={groups.reload} />}
      <div className="tablewrap"><table><thead><tr><th>מחזור</th><th>נושא</th><th>תלמידים</th><th>בדיקות שדווחו</th><th>מצב</th></tr></thead><tbody>
        {(groups.data ?? []).map(g => <tr key={g.id}><td>{g.yearId}</td><td>{g.topicId ? <Link to={`/topic/${g.topicId}`}>{topicById.get(g.topicId)?.he ?? g.topicId}</Link> : '—'}</td><td>{g.studentCount}{g.students.length ? ` (${g.students.map(s => s.label).join(', ')})` : ''}</td><td>{g.casesDeclared}/{g.studentCount}</td><td>{g.status}</td></tr>)}</tbody></table></div>
      {groups.data?.length === 0 && <p className="muted">אין קבוצות במוסד.</p>}

      <h3>תיקון היסטוריית נושאים</h3>
      {hist.loading && <Loading />}
      {(hist.data ?? []).length === 0 && <p className="muted">לא נמצאה היסטוריה. אפשר להוסיף שנה חדשה למטה.</p>}
      {(hist.data ?? []).map(h => (
        <div className="card stack" key={h.id}>
          <b>שנת {catalog?.years.find(y => y.id === h.yearId)?.label ?? academicYear(parseInt(h.yearId, 10)).label} ({h.yearId})</b>
          {edit === h.id && draft ? (
            <>
              {draft.items.map((it, i) => (
                <div className="row" key={it.groupId}>
                  <span>{topicById.get(it.topicId)?.he ?? it.topicHe}</span>
                  <select aria-label="מצב" style={{ inlineSize: 'auto' }} value={it.state} onChange={e => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, state: e.target.value as typeof it.state } : x)) })}>
                    {Object.entries(HISTORY_STATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button className="btn small danger" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>הסרה</button>
                </div>))}
              <div className="row">
                <select aria-label="הוספת נושא" value={newTopic} onChange={e => setNewTopic(e.target.value)} style={{ inlineSize: 'auto', maxInlineSize: 280 }}><option value="">הוספת נושא…</option>{catalog?.topics.map(t => <option key={t.id} value={t.id}>{t.he}</option>)}</select>
                <button className="btn small secondary" disabled={!newTopic} onClick={() => { const t = topicById.get(newTopic)!; setDraft({ ...draft, items: [...draft.items, { groupId: `c-${crypto.randomUUID().slice(0, 8)}`, topicId: t.id, familyId: t.familyId, topicHe: t.he, state: 'done' }] }); setNewTopic(''); }}>הוסף</button>
              </div>
              <div className="row"><button className="btn" disabled={busy} onClick={() => run(() => api.correctHistory(schoolId, h.yearId, draft.items)).then(r => { if (r !== undefined) { setEdit(null); hist.reload(); } })}>שמירת תיקון</button><button className="btn secondary" onClick={() => setEdit(null)}>ביטול</button></div>
            </>
          ) : (
            <>
              <ul className="tight">{h.items.map(i => <li key={i.groupId}>{topicById.get(i.topicId)?.he ?? i.topicHe}: {HISTORY_STATE_LABEL[i.state]}</li>)}{h.items.length === 0 && <li className="muted">ריק</li>}</ul>
              <div><button className="btn small secondary" onClick={() => { setEdit(h.id); setDraft(h); }}>עריכה</button></div>
            </>
          )}
        </div>
      ))}
      <NewYear schoolId={schoolId} onDone={hist.reload} />
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

function NewYear({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const { api } = useRT();
  const { catalog } = useCatalog();
  const [y, setY] = useState('');
  const { busy, error, run } = useBusy();
  const start = parseInt(catalog!.settings.currentYearId, 10);
  return (
    <form className="card row" onSubmit={e => { e.preventDefault(); run(() => api.correctHistory(schoolId, y, [])).then(r => { if (r !== undefined) { setY(''); onDone(); } }); }}>
      <Field label="הוספת שנה להיסטוריה (השלמת היסטוריה חסרה)"><select required value={y} onChange={e => setY(e.target.value)}><option value="">בחרו שנה…</option>{Array.from({ length: 10 }, (_, i) => academicYear(start - 1 - i)).map(a => <option key={a.id} value={a.id}>{a.label} ({a.id})</option>)}</select></Field>
      <button className="btn" disabled={busy || !y} style={{ alignSelf: 'end' }}>יצירת שנה</button>{error && <span className="err">{error}</span>}
    </form>
  );
}
