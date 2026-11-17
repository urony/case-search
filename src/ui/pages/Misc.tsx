import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { academicYear } from '../../domain/years';
import type { SchoolYearHistory } from '../../domain/types';
import { Field, Loading, Notice, PolicyBadge, useAsync, useBusy } from '../components';
import { useCatalog, useRT, useSession } from '../ctx';
import { HISTORY_STATE_LABEL, loadSchoolHistories } from '../history';
import { TopicCard } from './Home';

export function NewThisYear() {
  const { catalog, loading, sourceCounts } = useCatalog();
  const [year, setYear] = useState<string | null>(null);
  if (loading || !catalog) return <Loading />;
  const y = year ?? catalog.settings.currentYearId;
  const years = Array.from(new Set([...catalog.years.map(x => x.id), ...catalog.topics.map(t => t.addedYear).filter(Boolean) as string[]])).sort().reverse();
  const topics = catalog.topics.filter(t => t.addedYear === y && t.publish === 'published' && (t.policy === 'suitable' || t.policy === 'conditional'));
  const label = (id: string) => catalog.years.find(x => x.id === id)?.label ?? academicYear(parseInt(id, 10)).label;
  return (
    <div className="stack">
      <h2>נושאים חדשים שנוספו למאגר</h2>
      <label className="field" style={{ maxInlineSize: 260 }}><span className="lbl">שנת לימודים</span>
        <select value={y} onChange={e => setYear(e.target.value)}>{years.map(id => <option key={id} value={id}>{label(id)} ({id})</option>)}</select></label>
      <p className="muted small">הרשימה כוללת נושאים שנכנסו למאגר כמתאימים או כמתאימים בתנאים בהחלטת מנהל. טיוטה או הצעת מערכת אינה תוספת מאושרת, וחריג אישי אינו נושא חדש לכלל המורים.</p>
      {topics.length === 0 ? <div className="card empty">לא נוספו נושאים חדשים בשנה זו. ייבוא המיפוי הראשוני אינו נחשב תוספת.</div>
        : <div className="grid">{topics.map(t => <TopicCard key={t.id} topic={t} sources={sourceCounts[t.id] ?? 0} />)}</div>}
      <p>רוצים להציע נושא? <Link to="/requests/new-topic">הצעת נושא חדש</Link>.</p>
    </div>
  );
}

export function HistoryPage() {
  const { api } = useRT();
  const { ctx } = useSession();
  const { catalog, topicById } = useCatalog();
  const [code, setCode] = useState('');
  const [school, setSchool] = useState<{ id: string; name: string; city: string } | null>(null);
  const [hist, setHist] = useState<SchoolYearHistory[] | null>(null);
  const mine = useAsync(async () => (ctx.approved ? api.mySchools() : []), [api, ctx.approved]);
  const { busy, error, run } = useBusy();

  async function show(id: string) {
    setSchool(null); setHist(null);
    const r = await run(async () => {
      const s = (await api.getSchool(id)) ?? { id, name: id, city: '', active: true };
      const h = await loadSchoolHistories(api, s.id, catalog!.settings.currentYearId);
      return { s, h: h.histories };
    });
    if (r) { setSchool(r.s); setHist(r.h); }
  }
  useEffect(() => { if (ctx.role !== 'admin' && mine.data && mine.data.length === 1 && !school && !hist) show(mine.data[0].schoolId); }, [mine.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx.user) return <Notice kind="warn">היסטוריית נושאים של מוסד זמינה למורים מאושרים בלבד. יש <Link to="/login?next=/history">להיכנס</Link>.</Notice>;
  if (!ctx.approved) return <Notice kind="warn" title="הכתובת שלך עדיין לא אושרה. ">היסטוריית נושאים של מוסד זמינה למורים שהפיקוח אישר מראש ושויכו למוסד.</Notice>;
  return (
    <div className="stack">
      <h2>היסטוריית נושאים של מוסד</h2>
      <p>אילו נושאים נבחרו במוסד שלכם בשנים האחרונות. ההיסטוריה מכילה נושא, שנה ומצב בלבד, ללא תלמידים או מטופלים. היא זמינה רק למוסדות שאושרו לכם. הקלדת קוד מוסד אינה מקנה גישה.</p>
      {mine.data && mine.data.length > 1 && (
        <div className="card row">{mine.data.map(m => <button key={m.id} className="btn secondary" disabled={busy} onClick={() => show(m.schoolId)}>{m.school?.name ?? m.schoolId}</button>)}</div>
      )}
      {mine.data && mine.data.length === 0 && ctx.role !== 'admin' && <Notice kind="info">עדיין לא שויך לכם מוסד. השיוך נקבע בידי הפיקוח.</Notice>}
      {ctx.role === 'admin' && (
        <form className="card row" onSubmit={e => { e.preventDefault(); show(code.trim()); }}>
          <Field label="קוד מוסד (מנהל)"><input type="text" dir="ltr" value={code} onChange={e => setCode(e.target.value)} required autoComplete="off" /></Field>
          <button className="btn" disabled={busy} style={{ alignSelf: 'end' }}>{busy ? 'מחפש…' : 'הצגה'}</button>
        </form>
      )}
      {error && <Notice kind="bad">{error}</Notice>}
      {school && hist && (
        <div className="stack">
          <h3>{school.name}{school.city ? `, ${school.city}` : ''}</h3>
          {hist.length === 0 && <Notice kind="info" title="אין היסטוריה מתועדת. ">ייתכן שהמוסד חדש במערכת או שההיסטוריה טרם הוזנה. מורה יכול להצהיר, והרכז יכול להשלים.</Notice>}
          {hist.map(h => {
            const label = catalog?.years.find(y => y.id === h.yearId)?.label ?? academicYear(parseInt(h.yearId, 10)).label;
            return (
              <div className="card" key={h.id}>
                <b>שנת {label}</b> <span className="muted small">({h.yearId})</span>
                {h.items.length === 0 ? <p className="muted">אין נושאים מתועדים.</p> : (
                  <ul className="tight">{h.items.map(i => <li key={i.groupId}>{topicById.get(i.topicId)?.he ?? i.topicHe} <span className="badge neutral">{HISTORY_STATE_LABEL[i.state]}</span></li>)}</ul>
                )}
              </div>
            );
          })}
          <p className="small muted">היסטוריית עשר שנים היא לצפייה ולרצף, לא חסימה. אזהרת כפילות מתייחסת בעיקר לשנה הקודמת ולמחזור הנוכחי.</p>
        </div>
      )}
    </div>
  );
}

export function About() {
  const { catalog } = useCatalog();
  return (
    <div className="stack">
      <h2>מה הכלי בודק ומה הוא אינו מחליף</h2>
      <div className="card stack">
        <p><b>מה הכלי עושה.</b> עוזר למורה למצוא נושא לעבודת גמר במערכות רפואיות, להבין את תנאיו והגבלותיו, לבדוק התאמה של מקרה בלי לשמור נתוני מטופל, ולמצוא מקורות לאיתור מטופלים.</p>
        <p><b>מה הכלי אינו.</b> הוא אינו מנפיק אישור פיקוח, חתימה או מספר אישור. הוא אינו מחליף את הטופס הרשמי הקיים: המורים ממשיכים להגיש אותו. תשובה אוטומטית היא תשובת התאמה לפי המאגר והנתונים שהוזנו, ואינה אישור להתחלת פרויקט.</p>
        <p><b>פרטיות.</b> בדיקת התאמה למקרה מתבצעת בדפדפן בלבד. גיל, תאריכים ותשובות קליניות אינם נשלחים, אינם נשמרים ואינם מופיעים בכתובת. באתר אין מאגר מטופלים. בקבוצות נשמר מספר תלמידים (1–3) ושם פרטי או כינוי כרשות, עד סיום המחזור.</p>
        <p><b>תוויות.</b> ״מתאים כנושא״, ״מתאים בתנאים״, ״לא מתאים לפי הכלל הנוכחי״, ״חסר מידע״ ו״דורש בירור״. ״דורש בירור״ אינו פסילה: משמעו שתנאי טרם הוכרע ואין תשובה ודאית. עד שכללי הבדיקה של נושא הושלמו ואושרו, המערכת אינה נותנת תשובה חיובית ודאית.</p>
        <p><b>קושי באיתור.</b> הסימון ▲ הוא מידע מעשי בלבד ואינו תנאי פסילה.</p>
        <p><b>חריגים.</b> חריג לגבי מטופל מסוים מטופל בפנייה אישית לאחראי, מחוץ לאתר. אפשר לבקש חריג בכל נושא, אך בקשה אינה היתר אוטומטי. הצעת נושא חדש אינה מתפרסמת כמתאימה אלא בהחלטת מנהל.</p>
        <p><b>מועד הגשה.</b> {catalog?.settings.submissionNote}</p>
        <p><a href={catalog?.settings.officialFormUrl} target="_blank" rel="noopener noreferrer">לטופס הרשמי (נפתח בחלון חדש)</a></p>
      </div>
      <PolicyLegend />
    </div>
  );
}

function PolicyLegend() {
  return (
    <div className="card">
      <b>מקרא התוויות</b>
      <ul className="plain stack">
        <li><PolicyBadge policy="suitable" /> הנושא מופיע במאגר כמתאים; עדיין נדרשת עמידה בתנאים.</li>
        <li><PolicyBadge policy="conditional" /> הנושא מתאים בתנאים מפורטים בכרטיס.</li>
        <li><PolicyBadge policy="needs_review" /> תנאי טרם הוכרע מקצועית.</li>
        <li><PolicyBadge policy="not_suitable" /> הנושא מוחרג לפי הכלל הנוכחי. אפשר לבקש חריג.</li>
      </ul>
    </div>
  );
}
