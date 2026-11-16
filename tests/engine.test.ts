import { describe, expect, it } from 'vitest';
import { evaluateCase } from '../src/engine/evaluate';
import { validateRuleSet } from '../src/engine/validate';
import { DEFAULT_GENERAL_RULES } from '../src/engine/general';
import { AGE_QUESTION_ID, EngineTopic, RuleSet } from '../src/engine/types';

const NOW = new Date(2027, 10, 15); // 15.11.2027
const EMPTY: RuleSet = { questions: [], rules: [] };

function topic(over: Partial<EngineTopic> = {}): EngineTopic {
  return {
    id: 't1', he: 'נושא מלאכותי', policy: 'suitable', ageMin: null, ageMax: null,
    coverage: { level: 'full', reason: 'דוגמה מלאכותית', approvedBy: 'מנהל בדיקה', noCaseRulesNeeded: true },
    rules: EMPTY, generalThreshold: false, ...over,
  };
}

describe('T05/T35 גיל', () => {
  const t = topic({ ageMax: 18 });
  it('גיל 18 עובר', () => expect(evaluateCase(t, EMPTY, { [AGE_QUESTION_ID]: 18 }, NOW).verdict).toBe('suitable'));
  it('גיל 19 נכשל', () => {
    const r = evaluateCase(t, EMPTY, { [AGE_QUESTION_ID]: 19 }, NOW);
    expect(r.verdict).toBe('not_met');
    expect(r.failed[0].scope).toBe('age');
  });
  it('גיל חסר = חסר מידע ולא כישלון', () => {
    const r = evaluateCase(t, EMPTY, {}, NOW);
    expect(r.verdict).toBe('missing');
    expect(r.missingQuestions.map(q => q.id)).toEqual([AGE_QUESTION_ID]);
  });
  it('שינוי גבול גיל בנתונים משנה תוצאה בלי קוד', () => {
    expect(evaluateCase({ ...t, ageMax: 21 }, EMPTY, { [AGE_QUESTION_ID]: 19 }, NOW).verdict).toBe('suitable');
  });
  it('ageMin וגם ageMax', () => {
    const b = topic({ ageMin: 10, ageMax: 18 });
    expect(evaluateCase(b, EMPTY, { [AGE_QUESTION_ID]: 9 }, NOW).verdict).toBe('not_met');
    expect(evaluateCase(b, EMPTY, { [AGE_QUESTION_ID]: 10 }, NOW).verdict).toBe('suitable');
  });
});

describe('T13 אי־עמידה מול לא ידוע', () => {
  const rs: RuleSet = {
    questions: [{ id: 'tx', label: 'בטיפול קבוע?', type: 'yesno' }],
    rules: [{ id: 'r1', title: 'טיפול', teacherText: 'נדרש טיפול קבוע', severity: 'mandatory', status: 'published',
      cond: { q: 'tx', cmp: 'eq', value: 'yes' }, failText: 'אין טיפול קבוע' }],
  };
  const t = topic({ rules: rs, coverage: { level: 'full', reason: 'x', approvedBy: 'מ' } });
  it('לא = נכשל', () => expect(evaluateCase(t, EMPTY, { tx: 'no' }, NOW).verdict).toBe('not_met'));
  it('לא ידוע = חסר מידע', () => {
    expect(evaluateCase(t, EMPTY, { tx: 'unknown' }, NOW).verdict).toBe('missing');
    expect(evaluateCase(t, EMPTY, {}, NOW).verdict).toBe('missing');
  });
  it('כן = מתאים', () => expect(evaluateCase(t, EMPTY, { tx: 'yes' }, NOW).verdict).toBe('suitable'));
});

describe('T32 כיסוי חלקי וכלל שלוש השנים', () => {
  const t = topic({ generalThreshold: true, coverage: { level: 'none', reason: 'טרם הוגדר' } });
  it('כלל שלוש השנים לבדו לא מוביל לתוצאה חיובית', () => {
    const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { dx_date: { year: 2027, month: 6 }, clin_now: 'no' }, NOW);
    expect(r.verdict).toBe('needs_review');
    expect(r.coverageNote).toBeTruthy();
  });
  it('אבחנה לפני 3+ שנים בלי ביטוי: אי־עמידה בצד הבירור', () => {
    const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { dx_date: { year: 2023, month: 1 }, clin_now: 'no' }, NOW);
    expect(r.verdict).toBe('not_met');
    expect(r.failed[0].ruleId).toBe('general-3y');
  });
  it('אבחנה ישנה אך יש ביטוי קליני: הכלל עובר', () => {
    const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { dx_date: { year: 2020, month: 1 }, clin_now: 'yes' }, NOW);
    expect(r.failed).toHaveLength(0);
    expect(r.passed.map(p => p.ruleId)).toContain('general-3y');
  });
  it('בדיוק שלוש שנים נחשב "שלוש שנים ומעלה"', () => {
    const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { dx_date: { year: 2024, month: 11 }, clin_now: 'no' }, NOW);
    expect(r.verdict).toBe('not_met');
  });
  it('שנתיים ו־11 חודשים אינו מפעיל את הכלל', () => {
    const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { dx_date: { year: 2024, month: 12 }, clin_now: 'no' }, NOW);
    expect(r.failed).toHaveLength(0);
  });
  it('כיסוי מלא + עמידה בסף: מתאים', () => {
    const full = topic({ generalThreshold: true });
    const r = evaluateCase(full, DEFAULT_GENERAL_RULES, { dx_date: { year: 2027, month: 1 }, clin_now: 'no' }, NOW);
    expect(r.verdict).toBe('suitable');
  });
  it('תאריך עתידי נחשב חסר ולא עובר', () => {
    const r = evaluateCase(topic({ generalThreshold: true }), DEFAULT_GENERAL_RULES, { dx_date: { year: 2030, month: 1 }, clin_now: 'no' }, NOW);
    expect(r.verdict).toBe('missing');
  });
});

describe('T26 בירור פתוח אינו מחושב', () => {
  const rs: RuleSet = {
    questions: [],
    rules: [{ id: 'open1', title: 'חלון זמן באוטם', teacherText: 'חצי שנה או שנה? טרם הוכרע', severity: 'mandatory', status: 'published',
      cond: { op: 'all', items: [] }, openPolicyId: 'pq-mi-window' }],
  };
  it('מציג דורש בירור, לא פסילה ולא התאמה', () => {
    const r = evaluateCase(topic({ rules: rs, coverage: { level: 'partial', reason: 'x' } }), EMPTY, {}, NOW);
    expect(r.verdict).toBe('needs_review');
    expect(r.failed).toHaveLength(0);
    expect(r.clarifications).toHaveLength(1);
  });
  it('אפילו בכיסוי מלא, כלל פתוח מונע תוצאה חיובית', () => {
    const r = evaluateCase(topic({ rules: rs }), EMPTY, {}, NOW);
    expect(r.verdict).toBe('needs_review');
  });
});

describe('נושא מוחרג ומדיניות בירור', () => {
  it('מוחרג לפי הכלל הנוכחי', () => {
    const r = evaluateCase(topic({ policy: 'not_suitable' }), EMPTY, {}, NOW);
    expect(r.verdict).toBe('topic_excluded');
    expect(r.label).toBe('לא מתאים לפי הכלל הנוכחי');
  });
  it('מדיניות "דורש בירור" אינה נותנת התאמה', () => {
    expect(evaluateCase(topic({ policy: 'needs_review' }), EMPTY, {}, NOW).verdict).toBe('needs_review');
  });
  it('"מתאים בתנאים"', () => {
    expect(evaluateCase(topic({ policy: 'conditional' }), EMPTY, {}, NOW).verdict).toBe('conditional');
  });
  it('אי־עמידה גוברת על כיסוי חלקי ומוצגת לצד בירור', () => {
    const t = topic({ ageMax: 18, coverage: { level: 'partial', reason: 'x' } });
    const r = evaluateCase(t, EMPTY, { [AGE_QUESTION_ID]: 30 }, NOW);
    expect(r.verdict).toBe('not_met');
    expect(r.coverageNote).toBeTruthy();
  });
});

describe('לוגיקה תלת־ערכית', () => {
  const rs: RuleSet = {
    questions: [{ id: 'a', label: 'א', type: 'yesno' }, { id: 'b', label: 'ב', type: 'yesno' }],
    rules: [{ id: 'any', title: 'any', teacherText: 't', severity: 'mandatory', status: 'published',
      cond: { op: 'any', items: [{ q: 'a', cmp: 'eq', value: 'yes' }, { q: 'b', cmp: 'eq', value: 'yes' }] } }],
  };
  const t = topic({ rules: rs });
  it('any: אחד כן מספיק גם אם השני לא ידוע', () => expect(evaluateCase(t, EMPTY, { a: 'yes' }, NOW).verdict).toBe('suitable'));
  it('any: אחד לא והשני לא ידוע = חסר', () => expect(evaluateCase(t, EMPTY, { a: 'no' }, NOW).verdict).toBe('missing'));
  it('any: שניהם לא = נכשל', () => expect(evaluateCase(t, EMPTY, { a: 'no', b: 'no' }, NOW).verdict).toBe('not_met'));
  it('כלל אזהרה אינו חוסם', () => {
    const w = topic({ rules: { questions: rs.questions, rules: [{ ...rs.rules[0], severity: 'warning' }] } });
    const r = evaluateCase(w, EMPTY, { a: 'no', b: 'no' }, NOW);
    expect(r.verdict).toBe('suitable');
    expect(r.warnings).toHaveLength(1);
  });
  it('התייחסות לשאלה שאינה קיימת היא חסר מידע ולא ניחוש', () => {
    const bad = topic({ rules: { questions: [], rules: [{ ...rs.rules[0], cond: { q: 'ghost', cmp: 'eq', value: 'yes' } }] } });
    expect(evaluateCase(bad, EMPTY, {}, NOW).verdict).toBe('missing');
  });
});

describe('ולידציה לפני פרסום', () => {
  it('כיסוי מלא ללא מאשר נדחה', () => {
    const iss = validateRuleSet(EMPTY, { level: 'full', reason: 'x' }, { ageMin: null, ageMax: null });
    expect(iss.some(i => i.level === 'error' && i.message.includes('אישור מנהל'))).toBe(true);
  });
  it('כיסוי מלא ללא כללים וללא הכרעה מפורשת נדחה', () => {
    const iss = validateRuleSet(EMPTY, { level: 'full', reason: 'x', approvedBy: 'מ' }, { ageMin: null, ageMax: null });
    expect(iss.some(i => i.message.includes('אין צורך בשאלות'))).toBe(true);
  });
  it('התייחסות לשאלה לא קיימת', () => {
    const rs: RuleSet = { questions: [], rules: [{ id: 'r', title: 't', teacherText: 'x', severity: 'mandatory', status: 'published', cond: { q: 'zz', cmp: 'eq', value: 'yes' } }] };
    expect(validateRuleSet(rs, { level: 'partial', reason: 'x' }, { ageMin: null, ageMax: null }).some(i => i.message.includes('אינה קיימת'))).toBe(true);
  });
  it('כלל גיל הכללי תקין', () => {
    expect(validateRuleSet(DEFAULT_GENERAL_RULES, { level: 'partial', reason: 'x' }, { ageMin: null, ageMax: null }).filter(i => i.level === 'error')).toEqual([]);
  });
  it('כיסוי מלא עם כלל פתוח נדחה', () => {
    const rs: RuleSet = { questions: [], rules: [{ id: 'o', title: 't', teacherText: 'x', severity: 'mandatory', status: 'published', cond: { op: 'all', items: [] }, openPolicyId: 'p' }] };
    expect(validateRuleSet(rs, { level: 'full', reason: 'x', approvedBy: 'מ' }, { ageMin: null, ageMax: null }).some(i => i.message.includes('טרם הוכרע'))).toBe(true);
  });
  it('גיל מינימום גדול ממקסימום', () => {
    expect(validateRuleSet(EMPTY, { level: 'none', reason: '' }, { ageMin: 20, ageMax: 10 }).some(i => i.level === 'error')).toBe(true);
  });
});
