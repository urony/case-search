import { describe, expect, it } from 'vitest';
import { buildExceptionMailto, checkSourceInput, dueAtFor, duplicateWarnings, isOverdue, safePhone, safeWebUrl, SourceInput } from '../src/domain/helpers';
import { parseCsv, previewSchoolImport } from '../src/domain/csv';
import type { School, SchoolYearHistory } from '../src/domain/types';

const base: SourceInput = { topicId: 't-S054', title: 'עמותת דוגמה', kind: 'association', text: 'קבוצת תמיכה מלאכותית לבדיקה', url: '', phone: '', region: '', population: '', confirmNoPatientData: true };

describe('T08 קלט מקורות', () => {
  it('דוחה javascript:, data: ו־vbscript:', () => {
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd'])
      expect(safeWebUrl(u), u).toBeNull();
  });
  it('מקבל http/https ומשלים סכמה', () => {
    expect(safeWebUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeWebUrl('example.org')).toBe('https://example.org/');
  });
  it('מקור עם כתובת זדונית נדחה', () => {
    const r = checkSourceInput({ ...base, url: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
  });
  it('טקסט עם תגיות HTML נשמר כטקסט (React מציג כטקסט; אין dangerouslySetInnerHTML)', () => {
    const r = checkSourceInput({ ...base, text: '<img src=x onerror=alert(1)> קבוצה לבדיקה' });
    expect(r.ok).toBe(true);
    expect(r.clean!.text).toContain('<img');
  });
  it('דורש אישור "ללא פרטי מטופל"', () => {
    expect(checkSourceInput({ ...base, confirmNoPatientData: false }).ok).toBe(false);
  });
  it('אזהרה כשנראה כמו ת״ז או מייל', () => {
    expect(checkSourceInput({ ...base, text: 'פנו אל 123456789 בבקשה' }).warnings.length).toBeGreaterThan(0);
  });
  it('טלפון', () => {
    expect(safePhone('03-1234567')).toBe('031234567');
    expect(safePhone('abc')).toBeNull();
  });
});

describe('T14 חריג: mailto כללי בלבד', () => {
  it('הכותרת כוללת רק שם נושא; אין גוף', () => {
    const m = buildExceptionMailto({ responsibleEmail: 'owner@example.test' }, 'סוכרת מסוג 1')!;
    expect(m.startsWith('mailto:owner%40example.test?subject=')).toBe(true);
    expect(m).not.toContain('body=');
    expect(decodeURIComponent(m)).toContain('פנייה בנושא חריג: סוכרת מסוג 1');
  });
  it('ללא כתובת מוגדרת אין קישור', () => expect(buildExceptionMailto({ responsibleEmail: '' }, 'x')).toBeNull());
});

describe('T28 יעד טיפול', () => {
  const day = 86400000;
  it('ברירת מחדל שבעה ימים; איחור מסומן ואינו משנה סטטוס', () => {
    const due = dueAtFor(0, 7);
    expect(due).toBe(7 * day);
    expect(isOverdue({ status: 'open', dueAt: due }, 8 * day)).toBe(true);
    expect(isOverdue({ status: 'waiting_teacher', dueAt: due }, 8 * day)).toBe(false);
  });
  it('מנהל משנה את מספר הימים', () => expect(dueAtFor(0, 3)).toBe(3 * day));
});

describe('T16/T17 כפילות', () => {
  const hist = (yearId: string, items: SchoolYearHistory['items']): SchoolYearHistory => ({ id: `s1_${yearId}`, schoolId: 's1', yearId, items, updatedAt: 0 });
  const item = (state: SchoolYearHistory['items'][0]['state'], familyId = 'fam-copd') => ({ groupId: 'g' + state, topicId: 't', familyId, topicHe: 'COPD', state });
  const args = { familyId: 'fam-copd', currentYearId: '2027-28', prevYearId: '2026-27' };

  it('נושא שבוצע בשנה הקודמת מתריע', () => {
    const w = duplicateWarnings({ ...args, history: [hist('2026-27', [item('done')])] });
    expect(w.some(x => x.kind === 'prev_year_done')).toBe(true);
  });
  it('נושא מלפני כמה שנים אינו נחסם: מידע בלבד', () => {
    const w = duplicateWarnings({ ...args, history: [hist('2026-27', []), hist('2023-24', [item('done')])] });
    expect(w.some(x => x.kind === 'prev_year_done')).toBe(false);
    expect(w.some(x => x.kind === 'earlier_years_info')).toBe(true);
  });
  it('אושר אך לא בוצע / בוטל אינם נחשבים כבוצע', () => {
    const w = duplicateWarnings({ ...args, history: [hist('2026-27', [item('approved_not_done'), item('cancelled')])] });
    expect(w.some(x => x.kind === 'prev_year_done')).toBe(false);
  });
  it('התרעה לפי משפחה, לא כותרת: COPD ואמפיזמה אותה משפחה', () => {
    const w = duplicateWarnings({ ...args, familyId: 'fam-copd', history: [hist('2026-27', [{ ...item('done'), topicHe: 'אמפיזמה' }])] });
    expect(w.some(x => x.kind === 'prev_year_done')).toBe(true);
  });
  it('אותה מערכת אך משפחה אחרת: אין התרעה (צליאק/קרוהן)', () => {
    const w = duplicateWarnings({ ...args, familyId: 'fam-S034', history: [hist('2026-27', [item('done', 'fam-S035')])] });
    expect(w.filter(x => x.kind !== 'no_history')).toEqual([]);
  });
  it('קבוצה אחרת באותו מחזור: אזהרה; הקבוצה עצמה: לא', () => {
    const h = hist('2027-28', [{ ...item('declared'), groupId: 'g-other' }, { ...item('declared'), groupId: 'g-me' }]);
    expect(duplicateWarnings({ ...args, ownGroupId: 'g-me', history: [h] }).filter(x => x.kind === 'same_cycle')).toHaveLength(1);
    expect(duplicateWarnings({ ...args, ownGroupId: 'g-other', history: [hist('2027-28', [{ ...item('declared'), groupId: 'g-other' }])] }).filter(x => x.kind === 'same_cycle')).toHaveLength(0);
  });
  it('בהיעדר היסטוריה לשנה הקודמת: הודעה והצהרת מורה', () => {
    expect(duplicateWarnings({ ...args, history: [] })).toEqual([{ kind: 'no_history' }]);
  });
});

describe('ייבוא CSV של מוסדות', () => {
  const existing = new Map<string, School>([['111111', { id: '111111', name: 'ישן', city: 'א', active: true }]]);
  it('תצוגה מקדימה: חדש, עדכון, כפילות בקובץ ושגיאה', () => {
    const csv = 'קוד,שם,יישוב\n111111,בית ספר א,חיפה\n222222,בית ספר ב,עכו\n222222,כפול,עכו\n,בלי קוד,חיפה\n333333,,חיפה\n';
    const r = previewSchoolImport(csv, existing);
    expect(r.map(x => x.status)).toEqual(['update', 'new', 'duplicate_in_file', 'error', 'error']);
  });
  it('מפריד נקודה־פסיק ושדות עם מירכאות', () => {
    expect(parseCsv('a;b\n"x;y";z')).toEqual([['a', 'b'], ['x;y', 'z']]);
  });
  it('ללא כותרות', () => {
    expect(previewSchoolImport('444444,שם,עיר', new Map())[0].status).toBe('new');
  });
});
