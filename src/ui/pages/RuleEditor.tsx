import { useState } from 'react';
import type { Cmp, Cond, Question, QType, Rule, RuleSet } from '../../engine/types';
import type { PolicyQuestion } from '../../domain/types';
import { Field } from '../components';

const CMP_BY_TYPE: Record<QType, { id: Cmp; label: string }[]> = {
  yesno: [{ id: 'eq', label: 'שווה ל' }, { id: 'neq', label: 'שונה מ' }],
  number: [{ id: 'eq', label: 'שווה ל' }, { id: 'neq', label: 'שונה מ' }, { id: 'lt', label: 'קטן מ' }, { id: 'lte', label: 'קטן או שווה ל' }, { id: 'gt', label: 'גדול מ' }, { id: 'gte', label: 'גדול או שווה ל' }, { id: 'between', label: 'בטווח (כולל)' }],
  date: [{ id: 'lt', label: 'שחלף פחות מ' }, { id: 'lte', label: 'שחלף עד (כולל)' }, { id: 'gt', label: 'שחלף יותר מ' }, { id: 'gte', label: 'שחלף לפחות (כולל)' }, { id: 'between', label: 'שחלף בטווח (כולל)' }],
  choice: [{ id: 'eq', label: 'שווה ל' }, { id: 'neq', label: 'שונה מ' }, { id: 'in', label: 'אחד מ' }],
};
const TYPE_LABEL: Record<QType, string> = { yesno: 'כן / לא / לא ידוע', number: 'מספר', date: 'תאריך (חודש ושנה)', choice: 'בחירה מרשימה' };

type Leaf = Extract<Cond, { q: string }>;
const isLeaf = (c: Cond): c is Leaf => 'q' in c;

/** מחזיר רשימת עלים אם התנאי שטוח (all/any של עלים או עלה בודד); אחרת null (מבנה מורכב) */
function flat(c: Cond): { op: 'all' | 'any'; items: Leaf[] } | null {
  if (isLeaf(c)) return { op: 'all', items: [c] };
  if (c.op === 'not') return null;
  return c.items.every(isLeaf) ? { op: c.op, items: c.items as Leaf[] } : null;
}

export default function RuleSetEditor({ value, onChange, policyQuestions, reservedIds = [] }: {
  value: RuleSet; onChange: (v: RuleSet) => void; policyQuestions: PolicyQuestion[]; reservedIds?: string[];
}) {
  const setQ = (i: number, p: Partial<Question>) => onChange({ ...value, questions: value.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) });
  const setR = (i: number, p: Partial<Rule>) => onChange({ ...value, rules: value.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return (
    <div className="stack">
      <h3 style={{ marginBlockStart: 0 }}>שאלות לבדיקת מקרה</h3>
      <p className="help">שאלות שהמורה ימלא בבדיקה המקומית. התשובות אינן נשמרות. שאלת גיל נוצרת אוטומטית מגבולות הגיל בלשונית "פרטים".</p>
      {value.questions.map((q, i) => (
        <div className="card stack" key={i}>
          <div className="grid cols2">
            <Field label="מזהה (אנגלית, ללא רווחים)"><input type="text" dir="ltr" value={q.id} onChange={e => setQ(i, { id: e.target.value.replace(/\s/g, '_') })} /></Field>
            <Field label="סוג"><select value={q.type} onChange={e => setQ(i, { type: e.target.value as QType })}>{(Object.keys(TYPE_LABEL) as QType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></Field>
          </div>
          <Field label="נוסח השאלה"><input type="text" value={q.label} onChange={e => setQ(i, { label: e.target.value })} /></Field>
          <Field label="הסבר קצר (אופציונלי)"><input type="text" value={q.help ?? ''} onChange={e => setQ(i, { help: e.target.value })} /></Field>
          {q.type === 'choice' && <Field label="אפשרויות (שורה לכל אפשרות: ערך=תווית)"><textarea value={(q.choices ?? []).map(c => `${c.value}=${c.label}`).join('\n')} onChange={e => setQ(i, { choices: e.target.value.split('\n').filter(Boolean).map(l => { const [v, ...r] = l.split('='); return { value: v.trim(), label: (r.join('=') || v).trim() }; }) })} /></Field>}
          <div><button className="btn small danger" onClick={() => onChange({ ...value, questions: value.questions.filter((_, j) => j !== i) })}>מחיקת שאלה</button></div>
        </div>
      ))}
      <div><button className="btn small secondary" onClick={() => onChange({ ...value, questions: [...value.questions, { id: `q${value.questions.length + 1}`, label: '', type: 'yesno' }] })}>הוספת שאלה</button></div>

      <h3>כללים</h3>
      <p className="help">כלל חובה שאינו מתקיים מציג "לא עומד בכלל הנוכחי". ערך "לא ידוע" מציג "חסר מידע", לא כישלון. כלל אזהרה אינו חוסם. כלל שסומן "טרם הוכרע" אינו מחושב ומציג "דורש בירור".</p>
      {value.rules.map((r, i) => (
        <RuleBox key={i} rule={r} questions={value.questions} policyQuestions={policyQuestions} onChange={p => setR(i, p)} onDelete={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })} reserved={reservedIds} />
      ))}
      <div><button className="btn small secondary" onClick={() => onChange({ ...value, rules: [...value.rules, { id: `rule-${value.rules.length + 1}`, title: '', teacherText: '', severity: 'mandatory', status: 'draft', cond: { op: 'all', items: [] } }] })}>הוספת כלל</button></div>
    </div>
  );
}

function RuleBox({ rule, questions, policyQuestions, onChange, onDelete }: {
  rule: Rule; questions: Question[]; policyQuestions: PolicyQuestion[]; onChange: (p: Partial<Rule>) => void; onDelete: () => void; reserved: string[];
}) {
  const f = flat(rule.cond);
  const [json, setJson] = useState<string | null>(null);
  const setItems = (op: 'all' | 'any', items: Leaf[]) => onChange({ cond: { op, items } });
  return (
    <div className="card stack">
      <div className="grid cols2">
        <Field label="מזהה כלל"><input type="text" dir="ltr" value={rule.id} onChange={e => onChange({ id: e.target.value.replace(/\s/g, '-') })} /></Field>
        <Field label="סטטוס"><select value={rule.status} onChange={e => onChange({ status: e.target.value as Rule['status'] })}><option value="draft">טיוטה</option><option value="published">פורסם</option><option value="disabled">מושבת</option></select></Field>
        <Field label="כותרת"><input type="text" value={rule.title} onChange={e => onChange({ title: e.target.value })} /></Field>
        <Field label="חומרה"><select value={rule.severity} onChange={e => onChange({ severity: e.target.value as Rule['severity'] })}><option value="mandatory">תנאי חובה</option><option value="warning">אזהרה (אינה חוסמת)</option></select></Field>
      </div>
      <Field label="נוסח למורה"><textarea value={rule.teacherText} onChange={e => onChange({ teacherText: e.target.value })} /></Field>
      <Field label="מקור הכלל (מסמך ועמוד או החלטת מנהל)"><input type="text" value={rule.source ?? ''} onChange={e => onChange({ source: e.target.value })} /></Field>

      <Field label="אופן החישוב">
        <select value={rule.openPolicyId ? 'open' : 'computed'} onChange={e => onChange({ openPolicyId: e.target.value === 'open' ? (policyQuestions[0]?.id ?? 'open') : undefined })}>
          <option value="computed">מחושב לפי התנאי</option><option value="open">טרם הוכרע מקצועית (דורש בירור, לא מחושב)</option>
        </select></Field>
      {rule.openPolicyId && (
        <Field label="שאלה מקצועית פתוחה קשורה" help="אין להמציא תשובה. הכלל יוצג למורה כ״דורש בירור״ עד שתוזן הכרעה.">
          <select value={rule.openPolicyId} onChange={e => onChange({ openPolicyId: e.target.value })}>
            {!policyQuestions.some(p => p.id === rule.openPolicyId) && <option value={rule.openPolicyId}>{rule.openPolicyId}</option>}
            {policyQuestions.map(p => <option key={p.id} value={p.id}>{p.topic}: {p.question.slice(0, 60)}</option>)}</select></Field>
      )}

      {!rule.openPolicyId && (
        <>
          {f ? (
            <fieldset><legend>תנאי</legend>
              <div className="row"><span>העמידה בכלל מחייבת</span>
                <select aria-label="קשר בין התנאים" value={f.op} onChange={e => setItems(e.target.value as 'all' | 'any', f.items)} style={{ inlineSize: 'auto' }}>
                  <option value="all">את כל התנאים הבאים</option><option value="any">לפחות אחד מהתנאים הבאים</option></select></div>
              {f.items.map((l, i) => <LeafRow key={i} leaf={l} questions={questions} onChange={nl => setItems(f.op, f.items.map((x, j) => (j === i ? nl : x)))} onDelete={() => setItems(f.op, f.items.filter((_, j) => j !== i))} />)}
              <button className="btn small secondary" onClick={() => setItems(f.op, [...f.items, { q: questions[0]?.id ?? '', cmp: 'eq', value: 'yes' }])} disabled={questions.length === 0}>הוספת תנאי</button>
              {questions.length === 0 && <span className="help"> הוסיפו שאלה תחילה.</span>}
              <button className="linkbtn small" onClick={() => setJson(JSON.stringify(rule.cond, null, 2))}>עריכה מתקדמת (JSON)</button>
            </fieldset>
          ) : (
            <Field label="תנאי מורכב (JSON). מבנה מקונן נתמך במנוע ונערך כאן כטקסט" help="מותרים רק all, any, not והשוואות. אין קוד להרצה."><textarea dir="ltr" value={json ?? JSON.stringify(rule.cond, null, 2)} onChange={e => { setJson(e.target.value); try { onChange({ cond: JSON.parse(e.target.value) }); } catch { /* ממתין לתקינות */ } }} /></Field>
          )}
          {f && json !== null && <Field label="JSON"><textarea dir="ltr" value={json} onChange={e => { setJson(e.target.value); try { onChange({ cond: JSON.parse(e.target.value) }); } catch { /* ממתין */ } }} /></Field>}
          <Field label="הודעה כשהתנאי אינו מתקיים"><input type="text" value={rule.failText ?? ''} onChange={e => onChange({ failText: e.target.value })} /></Field>
          <Field label="הודעה כשחסר מידע"><input type="text" value={rule.missingText ?? ''} onChange={e => onChange({ missingText: e.target.value })} /></Field>
        </>
      )}
      <div><button className="btn small danger" onClick={onDelete}>מחיקת כלל</button></div>
    </div>
  );
}

function LeafRow({ leaf, questions, onChange, onDelete }: { leaf: Leaf; questions: Question[]; onChange: (l: Leaf) => void; onDelete: () => void }) {
  const q = questions.find(x => x.id === leaf.q);
  const type = q?.type ?? 'yesno';
  const set = (p: Partial<Leaf>) => onChange({ ...leaf, ...p } as Leaf);
  return (
    <div className="row" style={{ marginBlock: 6 }}>
      <select aria-label="שאלה" value={leaf.q} onChange={e => { const nq = questions.find(x => x.id === e.target.value); onChange({ q: e.target.value, cmp: CMP_BY_TYPE[nq?.type ?? 'yesno'][0].id, value: nq?.type === 'yesno' ? 'yes' : nq?.type === 'choice' ? (nq.choices?.[0]?.value ?? '') : 0, ...(nq?.type === 'date' ? { unit: 'years' as const } : {}) } as Leaf); }} style={{ inlineSize: 'auto', maxInlineSize: 240 }}>
        {!q && <option value={leaf.q}>{leaf.q || 'בחרו שאלה'}</option>}
        {questions.map(x => <option key={x.id} value={x.id}>{x.label || x.id}</option>)}</select>
      <select aria-label="השוואה" value={leaf.cmp} onChange={e => set({ cmp: e.target.value as Cmp })} style={{ inlineSize: 'auto' }}>{CMP_BY_TYPE[type].map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      {type === 'yesno' && <select aria-label="ערך" value={String(leaf.value)} onChange={e => set({ value: e.target.value })} style={{ inlineSize: 'auto' }}><option value="yes">כן</option><option value="no">לא</option></select>}
      {(type === 'number' || type === 'date') && <input aria-label="ערך" type="number" style={{ inlineSize: 90 }} value={typeof leaf.value === 'number' ? leaf.value : ''} onChange={e => set({ value: Number(e.target.value) })} />}
      {(type === 'number' || type === 'date') && leaf.cmp === 'between' && <><span>עד</span><input aria-label="ערך עליון" type="number" style={{ inlineSize: 90 }} value={leaf.value2 ?? ''} onChange={e => set({ value2: Number(e.target.value) })} /></>}
      {type === 'date' && <select aria-label="יחידת זמן" value={leaf.unit ?? 'years'} onChange={e => set({ unit: e.target.value as 'years' | 'months' })} style={{ inlineSize: 'auto' }}><option value="years">שנים שלמות</option><option value="months">חודשים</option></select>}
      {type === 'choice' && (leaf.cmp === 'in'
        ? <input aria-label="ערכים מופרדים בפסיק" type="text" value={Array.isArray(leaf.value) ? leaf.value.join(',') : String(leaf.value)} onChange={e => set({ value: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
        : <select aria-label="ערך" value={String(leaf.value)} onChange={e => set({ value: e.target.value })} style={{ inlineSize: 'auto' }}>{(q?.choices ?? []).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select>)}
      <button className="btn small danger" aria-label="מחיקת תנאי" onClick={onDelete}>✕</button>
    </div>
  );
}
