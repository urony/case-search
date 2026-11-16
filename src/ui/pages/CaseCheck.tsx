import { useMemo, useState } from 'react';
import { collectQuestions, evaluateCase } from '../../engine/evaluate';
import type { Answers, AnswerValue, EngineTopic, Outcome, Question, RuleSet } from '../../engine/types';
import { Notice } from '../components';

/**
 * בדיקת התאמה למקרה. כל החישוב מקומי בדפדפן: התשובות נשמרות רק בזיכרון הרכיב (useState),
 * לא ב-localStorage/sessionStorage/IndexedDB, לא בכתובת, ולא נשלחות לרשת (סעיף 12.2).
 */
export default function CaseCheck({ topic, general, policyLabel, officialFormUrl, groupInfo, onDeclare, simulate }: {
  topic: EngineTopic; general: RuleSet; policyLabel: string; officialFormUrl: string;
  groupInfo?: { count: number; declared: number; label: string };
  onDeclare?: (n: number) => Promise<void>;
  simulate?: boolean;
}) {
  const questions = useMemo(() => collectQuestions(topic, general), [topic, general]);
  const [answers, setAnswers] = useState<Answers>({});
  const [checked, setChecked] = useState(false);
  const [declared, setDeclared] = useState<string | null>(null);
  const result = useMemo(() => (checked ? evaluateCase(topic, general, answers) : null), [checked, topic, general, answers]);

  const set = (id: string, v: AnswerValue | undefined) => { setAnswers(a => ({ ...a, [id]: v })); setChecked(false); };
  const reset = () => { setAnswers({}); setChecked(false); setDeclared(null); };

  return (
    <div className="stack">
      <Notice kind="info" title="הבדיקה מתבצעת במכשיר שלכם בלבד. ">
        התשובות אינן נשלחות לשרת, אינן נשמרות, ואינן מופיעות בכתובת. רענון הדף או יציאה ימחקו אותן.
        אל תזינו שם, מספר זהות או פרטי קשר של מטופל. כדי לבדוק מקרה נוסף, נקו והתחילו מחדש.
      </Notice>
      {simulate && <Notice kind="warn" title="הדמיית מנהל: ">השתמשו בנתונים מלאכותיים בלבד. אין להזין פרטי מטופל אמיתיים.</Notice>}

      {topic.policy === 'not_suitable' && (
        <Notice kind="bad" title="הנושא מוחרג לפי הכלל הנוכחי. ">אפשר לבקש חריג אישי מהאחראי. בקשת חריג אינה היתר אוטומטי.</Notice>
      )}

      {questions.length === 0 && topic.policy !== 'not_suitable' && <p className="muted">לנושא זה טרם הוגדרו שאלות לבדיקת מקרה. אפשר ללחוץ "בדיקה" כדי לראות מה חסר.</p>}

      <form autoComplete="off" onSubmit={e => { e.preventDefault(); setChecked(true); }} className="card stack" aria-label="שאלות לבדיקת מקרה">
        {questions.map(q => <QuestionInput key={q.id} q={q} value={answers[q.id]} onChange={v => set(q.id, v)} />)}
        <div className="row">
          <button className="btn" type="submit">בדיקה</button>
          <button className="btn secondary" type="button" onClick={reset}>ניקוי והתחלת בדיקה נוספת</button>
        </div>
      </form>

      {result && (
        <div className={`card result ${result.verdict}`} aria-live="polite">
          <h3>{result.label}</h3>
          <p>{result.summary}</p>
          <div className="sep4">
            <div><b>התאמת הנושא במאגר</b>{policyLabel}</div>
            <div><b>התאמת המקרה לפי התנאים שהוזנו</b>{result.label}</div>
            <div><b>שלמות ההרכב הקבוצתי</b>{groupInfo ? `${groupInfo.declared} מתוך ${groupInfo.count} בדיקות דווחו${groupInfo.declared < groupInfo.count ? ' (התקדמות חלקית: אין עדיין שלמות קבוצתית)' : ''}` : 'לא נבחרה קבוצה'}</div>
            <div><b>הגשה רשמית חיצונית</b>נעשית בטופס הקיים; תוצאה זו אינה מחליפה אותה</div>
          </div>
          {result.coverageNote && <Notice kind="warn">{result.coverageNote}</Notice>}
          <OutcomeList title="תנאי חובה שאינם מתקיימים" items={result.failed} kind="bad" field="text" />
          <OutcomeList title="תנאים שדורשים בירור (טרם הוכרעו, אינם פסילה)" items={result.clarifications} kind="info" />
          {result.missingQuestions.length > 0 && (
            <div><b>מידע חסר:</b><ul className="tight">{result.missingQuestions.map(q => <li key={q.id}>{q.label}</li>)}</ul></div>
          )}
          <OutcomeList title="אזהרות (אינן חוסמות)" items={result.warnings} kind="warn" field="text" />
          <OutcomeList title="תנאים שמתקיימים" items={result.passed} kind="ok" />
          <p className="small muted">הערה על קושי באיתור מטופלים אינה משנה את תוצאת ההתאמה.</p>
          <div className="row">
            <a className="btn secondary small" href={officialFormUrl} target="_blank" rel="noopener noreferrer">לטופס הרשמי (נפתח בחלון חדש)</a>
          </div>
        </div>
      )}

      {groupInfo && onDeclare && (
        <div className="card">
          <b>דיווח לקבוצה ({groupInfo.label})</b>
          <p className="small muted">הדיווח הוא מספר בלבד: כמה מקרים נבדקו לדעתכם. לא נשמרת תוצאה, שם או פרט של מטופל.</p>
          <div className="row">
            {Array.from({ length: groupInfo.count + 1 }, (_, n) => (
              <button key={n} className={`btn small ${n === groupInfo.declared ? '' : 'secondary'}`} onClick={() => onDeclare(n).then(() => setDeclared(`עודכן: ${n} מתוך ${groupInfo.count}`)).catch(e => setDeclared(String(e.message)))}>{n} מתוך {groupInfo.count}</button>
            ))}
          </div>
          {declared && <p role="status">{declared}</p>}
        </div>
      )}
    </div>
  );
}

function OutcomeList({ title, items, kind, field }: { title: string; items: Outcome[]; kind: 'bad' | 'warn' | 'info' | 'ok'; field?: 'text' }) {
  if (!items.length) return null;
  return (
    <Notice kind={kind} title={`${title}: `}>
      <ul className="tight">{items.map(o => <li key={o.ruleId}><b>{o.title}.</b> {field === 'text' && o.text ? o.text : o.teacherText}</li>)}</ul>
    </Notice>
  );
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function QuestionInput({ q, value, onChange }: { q: Question; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void }) {
  const id = `q-${q.id}`;
  if (q.type === 'yesno') {
    const v = value === 'yes' || value === 'no' ? value : 'unknown';
    return (
      <fieldset><legend>{q.label}</legend>
        {(['yes', 'no', 'unknown'] as const).map(o => (
          <label key={o} className="row" style={{ display: 'inline-flex', marginInlineEnd: 16 }}>
            <input type="radio" name={id} checked={v === o} onChange={() => onChange(o)} /> {o === 'yes' ? 'כן' : o === 'no' ? 'לא' : 'לא ידוע'}
          </label>
        ))}
        {q.help && <div className="help">{q.help}</div>}
      </fieldset>
    );
  }
  if (q.type === 'number') {
    return (
      <label className="field"><span className="lbl">{q.label}{q.unit ? ` (${q.unit})` : ''}</span>
        <input type="number" inputMode="numeric" autoComplete="off" value={typeof value === 'number' ? value : ''} onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
        <span className="help">{q.help ? `${q.help} ` : ''}שדה ריק = לא ידוע.</span></label>
    );
  }
  if (q.type === 'date') {
    const d = typeof value === 'object' && value && 'year' in value ? value : null;
    const upd = (year?: number, month?: number) => {
      const y = year ?? d?.year, m = month ?? d?.month;
      onChange(y && m ? { year: y, month: m } : undefined);
    };
    return (
      <fieldset><legend>{q.label}</legend>
        <div className="row">
          <select aria-label="חודש" value={d?.month ?? ''} onChange={e => upd(undefined, Number(e.target.value) || undefined)} style={{ inlineSize: 140 }}>
            <option value="">חודש (לא ידוע)</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input aria-label="שנה" type="number" placeholder="שנה" autoComplete="off" style={{ inlineSize: 110 }} value={d?.year ?? ''} onChange={e => upd(Number(e.target.value) || undefined, undefined)} />
        </div>
        <div className="help">{q.help ? `${q.help} ` : ''}חודש ושנה מספיקים. אם אחד מהם חסר, התשובה נחשבת לא ידועה.</div>
      </fieldset>
    );
  }
  const c = typeof value === 'object' && value && 'choice' in value ? value.choice : '';
  return (
    <label className="field"><span className="lbl">{q.label}</span>
      <select value={c} onChange={e => onChange(e.target.value ? { choice: e.target.value } : undefined)}>
        <option value="">לא ידוע</option>{(q.choices ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select></label>
  );
}
