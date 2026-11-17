import { Link } from 'react-router-dom';
import { ageLine } from '../../domain/helpers';
import type { Policy, PublicSource, SystemDef, Topic } from '../../domain/types';
import { safePhone, safeWebUrl, SOURCE_KINDS } from '../../domain/helpers';
import { DifficultyMark, En, fmtDate, Notice } from '../components';

/** תוויות הגרסה הראשונה. הטקסט הוא החלק המחייב; הצבע והסמל רק תומכים. */
export const V1_LABEL: Record<Policy, string> = {
  suitable: 'מאושר כנושא',
  conditional: 'מאושר בתנאים',
  not_suitable: 'אינו מאושר כנושא',
  needs_review: 'דורש בירור',
};
const CLASS: Record<Policy, string> = { suitable: 'ok', conditional: 'warn', not_suitable: 'bad', needs_review: 'info' };
const ICON: Record<Policy, string> = { suitable: '✓', conditional: '◐', not_suitable: '✕', needs_review: '?' };

export const V1_EXPLAIN: Record<Policy, string> = {
  suitable: 'הנושא מופיע ברשימה הרשמית כנושא מאושר. גם נושא מאושר כפוף לתנאי הסף הכלליים ולאישור הפיקוח, ולכן אין זו התחייבות לגבי מקרה מסוים.',
  conditional: 'הנושא מאושר רק בהתקיים התנאים המפורטים כאן. יש לקרוא את התנאים לפני שמחפשים מטופלים.',
  not_suitable: 'לפי הרשימה הרשמית הנושא אינו מאושר כנושא לעבודת גמר. האתר אינו מקבל בקשות חריגים; לפנייה בנושא יש לפנות לפיקוח לפי ההנחיות.',
  needs_review: 'המקורות אינם חד־משמעיים או סותרים, ולכן אין כרגע תשובה ודאית. אל תניחו שהנושא מאושר או שאינו מאושר: יש לברר מול הפיקוח לפני שבוחרים בו.',
};

export function StatusBadge({ policy }: { policy: Policy }) {
  return <span className={`badge ${CLASS[policy]}`}><span aria-hidden="true">{ICON[policy]}</span>{V1_LABEL[policy]}</span>;
}

/** תקציר התנאים לכרטיס תוצאה: גיל (אם קודד) ואחריו נוסח המקור, מקוצר */
export function conditionSnippet(t: Topic, max = 150): string {
  const parts: string[] = [];
  const age = ageLine(t);
  if (age) parts.push(age);
  if (t.sourceCondition) parts.push(t.sourceCondition);
  const s = parts.join(' · ');
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s;
}

const NOTE_TYPE: Record<string, string> = { condition: 'תנאי', difficulty: 'קושי באיתור', attention: 'שימו לב', clarification: 'נדרש בירור' };
const NOTE_KIND: Record<string, 'info' | 'warn' | 'bad'> = { info: 'info', warning: 'warn', high: 'bad' };

/**
 * גוף כרטיס הנושא בגרסה הראשונה. מציג בסדר הזה: שם, מערכות, מעמד והסבר, תנאים והערות (לא בלשונית צדדית),
 * קושי באיתור (רק אם נקבע), מקורות לאיתור מטופלים (או הודעה שטרם נוספו), מקור המידע, והבהרה על אישור פיקוח.
 */
export function TopicBody({ topic, systems, generalText, sources, updatedAt }: {
  topic: Topic; systems: SystemDef[]; generalText?: string; sources: PublicSource[]; updatedAt?: number;
}) {
  const sysLabels = topic.systems.map(id => systems.find(s => s.id === id)).filter(Boolean) as SystemDef[];
  const age = ageLine(topic);
  const notes = topic.notes.filter(n => n.active && n.type !== 'difficulty');
  const critical = notes.filter(n => n.severity !== 'info');
  const rest = notes.filter(n => n.severity === 'info');
  const showReview = topic.reviewNote && !/אין תנאי ייעודי נוסף/.test(topic.reviewNote);
  const showGeneral = !!generalText && topic.generalThreshold && (topic.policy === 'suitable' || topic.policy === 'conditional');
  return (
    <article className="card stack topic-full">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{topic.he}</h2>
        <StatusBadge policy={topic.policy} />
      </div>
      {topic.en && <span className="en">{topic.en}</span>}
      {sysLabels.length > 0 && (
        <div className="row small" aria-label="מערכות הגוף">
          <span className="muted">מערכות:</span>
          {sysLabels.map(s => <Link key={s.id} className="badge neutral" to={`/?system=${s.id}`}>{s.label}</Link>)}
        </div>
      )}

      <Notice kind={topic.policy === 'suitable' ? 'ok' : topic.policy === 'conditional' ? 'warn' : topic.policy === 'not_suitable' ? 'bad' : 'info'} title={`${V1_LABEL[topic.policy]}. `}>{V1_EXPLAIN[topic.policy]}</Notice>

      <section aria-labelledby="cond-h">
        <h3 id="cond-h" style={{ marginBlockStart: 0 }}>{topic.policy === 'not_suitable' ? 'מה כתוב במקור' : 'תנאים והגבלות'}</h3>
        {age && <p><b>גיל:</b> {age}.</p>}
        {topic.sourceCondition
          ? <p>{topic.sourceCondition}</p>
          : !age && <p className="muted">לא נרשם תנאי ייעודי לנושא זה במקורות.</p>}
        {showGeneral && <p><b>תנאי כללי:</b> {generalText}</p>}
        {critical.map(n => <Notice key={n.id} kind={NOTE_KIND[n.severity]} title={`${NOTE_TYPE[n.type]}: ${n.title}. `}>{n.text}</Notice>)}
      </section>

      {(showReview || rest.length > 0) && (
        <section aria-labelledby="notes-h">
          <h3 id="notes-h" style={{ marginBlockStart: 0 }}>{topic.policy === 'needs_review' ? 'מה דורש בירור' : 'הערות למורה ולתלמיד'}</h3>
          {showReview && <p>{topic.reviewNote}</p>}
          {rest.map(n => <p key={n.id}><b>{n.title}:</b> {n.text}</p>)}
        </section>
      )}

      {topic.difficulty > 0 && (
        <section aria-labelledby="diff-h">
          <h3 id="diff-h" style={{ marginBlockStart: 0 }}>קושי באיתור מטופלים</h3>
          <p><DifficultyMark level={topic.difficulty} /></p>
          <p className="small muted">זהו מידע מעשי בלבד ואינו תנאי פסילה.</p>
        </section>
      )}

      <section aria-labelledby="src-h">
        <h3 id="src-h" style={{ marginBlockStart: 0 }}>מקורות לאיתור מטופלים{sources.length ? ` (${sources.length})` : ''}</h3>
        {sources.length === 0
          ? <p className="muted">טרם נוספו מקורות לאיתור מטופלים.</p>
          : <div className="stack">{sources.map(s => <SourceItem key={s.id} s={s} />)}</div>}
        {sources.length > 0 && <p className="small muted">מקור איתור הוא פרטי קשר של ארגון, אתר או קבוצה. אין בו פרטי מטופלים, והוא אינו משנה את תנאי ההתאמה.</p>}
      </section>

      <p className="small muted">
        <b>מקור המידע:</b> מסמכי התוכנית, עמודים <bdi>{topic.sourcePages || 'לא צוין'}</bdi>.{' '}
        {topic.sourceMapped ? 'זהו מיפוי ראשוני של המקורות, שטרם נבדק סופית בידי מנהל האתר.' : 'הרשומה נבדקה ועודכנה בידי מנהל האתר.'}
        {updatedAt ? <> המידע באתר עודכן לאחרונה ב־{fmtDate(updatedAt)}.</> : null}
        {topic.aliases.length > 0 && <> שמות נוספים: {topic.aliases.map((a, i) => <span key={a}>{i > 0 && ', '}<En>{a}</En></span>)}.</>}
      </p>
      <Notice kind="info">המידע מתייחס להתאמת הנושא. בחירת מטופלים והגשת הנושא כפופות להנחיות ולאישור הפיקוח.</Notice>
    </article>
  );
}

function SourceItem({ s }: { s: PublicSource }) {
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
    </div>
  );
}
