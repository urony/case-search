import {
  AGE_QUESTION_ID, Answers, CaseResult, Cond, EngineTopic, Outcome, Question, Rule, RuleSet, Tri, Verdict, AnswerValue,
} from './types';

export const VERDICT_LABELS: Record<Verdict, string> = {
  suitable: 'מתאים כנושא',
  conditional: 'מתאים בתנאים',
  not_met: 'לא מתאים לפי הכלל הנוכחי',
  missing: 'חסר מידע',
  needs_review: 'דורש בירור',
  topic_excluded: 'לא מתאים לפי הכלל הנוכחי',
};

export const AGE_QUESTION: Question = {
  id: AGE_QUESTION_ID,
  label: 'גיל בשנים שלמות',
  help: 'גיל בזמן הבדיקה. בלי תאריך לידה.',
  type: 'number',
  unit: 'שנים',
};

function isKnown(a: AnswerValue | undefined): a is Exclude<AnswerValue, 'unknown'> {
  return a !== undefined && a !== 'unknown';
}

/** חודשים שחלפו מתאריך (שנה+חודש) עד מועד הייחוס. null אם התאריך לא תקין או עתידי. */
export function monthsSince(d: { year: number; month: number }, now: Date): number | null {
  if (!Number.isFinite(d.year) || !Number.isFinite(d.month) || d.month < 1 || d.month > 12) return null;
  const diff = now.getFullYear() * 12 + (now.getMonth() + 1) - (d.year * 12 + d.month);
  return diff < 0 ? null : diff;
}

function cmpNum(a: number, cmp: string, v: number, v2?: number): Tri {
  switch (cmp) {
    case 'eq': return a === v ? 'pass' : 'fail';
    case 'neq': return a !== v ? 'pass' : 'fail';
    case 'lt': return a < v ? 'pass' : 'fail';
    case 'lte': return a <= v ? 'pass' : 'fail';
    case 'gt': return a > v ? 'pass' : 'fail';
    case 'gte': return a >= v ? 'pass' : 'fail';
    case 'between': return v2 !== undefined && a >= v && a <= v2 ? 'pass' : 'fail';
    default: return 'missing';
  }
}

export function evalCond(cond: Cond, qs: Map<string, Question>, answers: Answers, now: Date): Tri {
  if ('op' in cond) {
    if (cond.op === 'not') {
      const r = evalCond(cond.item, qs, answers, now);
      return r === 'pass' ? 'fail' : r === 'fail' ? 'pass' : 'missing';
    }
    const rs = cond.items.map(i => evalCond(i, qs, answers, now));
    if (cond.op === 'all') {
      if (rs.includes('fail')) return 'fail';
      if (rs.includes('missing') || rs.length === 0) return 'missing';
      return 'pass';
    }
    if (rs.includes('pass')) return 'pass';
    if (rs.includes('missing') || rs.length === 0) return 'missing';
    return 'fail';
  }
  const q = qs.get(cond.q);
  if (!q) return 'missing'; // התייחסות לשאלה לא קיימת: לא מנחשים
  const a = answers[cond.q];
  if (!isKnown(a)) return 'missing';
  switch (q.type) {
    case 'yesno':
      if (a !== 'yes' && a !== 'no') return 'missing';
      if (cond.cmp === 'eq') return a === cond.value ? 'pass' : 'fail';
      if (cond.cmp === 'neq') return a !== cond.value ? 'pass' : 'fail';
      return 'missing';
    case 'number':
      if (typeof a !== 'number' || !Number.isFinite(a)) return 'missing';
      if (typeof cond.value !== 'number') return 'missing';
      return cmpNum(a, cond.cmp, cond.value, cond.value2);
    case 'date': {
      if (typeof a !== 'object' || !('year' in a)) return 'missing';
      const m = monthsSince(a, now);
      if (m === null || typeof cond.value !== 'number') return 'missing';
      const elapsed = cond.unit === 'months' ? m : Math.floor(m / 12);
      return cmpNum(elapsed, cond.cmp, cond.value, cond.value2);
    }
    case 'choice': {
      if (typeof a !== 'object' || !('choice' in a)) return 'missing';
      if (cond.cmp === 'eq') return a.choice === cond.value ? 'pass' : 'fail';
      if (cond.cmp === 'neq') return a.choice !== cond.value ? 'pass' : 'fail';
      if (cond.cmp === 'in' && Array.isArray(cond.value)) return cond.value.includes(a.choice) ? 'pass' : 'fail';
      return 'missing';
    }
  }
}

/** מזהי שאלות שמופיעות בתנאי */
export function condQuestionIds(c: Cond, out = new Set<string>()): Set<string> {
  if ('op' in c) {
    if (c.op === 'not') condQuestionIds(c.item, out);
    else c.items.forEach(i => condQuestionIds(i, out));
  } else out.add(c.q);
  return out;
}

function outcomeFor(rule: Rule, scope: Outcome['scope'], state: Outcome['state']): Outcome {
  return {
    ruleId: rule.id, title: rule.title, teacherText: rule.teacherText, severity: rule.severity, scope, state,
    text: state === 'fail' ? rule.failText : state === 'missing' ? rule.missingText : undefined,
  };
}

/** כלל גיל נגזר מגבולות הגיל של הנושא (סעיף 9.3). null = אין גבול. */
export function ageRule(ageMin: number | null, ageMax: number | null): Rule | null {
  if (ageMin === null && ageMax === null) return null;
  const items: Cond[] = [];
  if (ageMin !== null) items.push({ q: AGE_QUESTION_ID, cmp: 'gte', value: ageMin });
  if (ageMax !== null) items.push({ q: AGE_QUESTION_ID, cmp: 'lte', value: ageMax });
  const txt = ageMin !== null && ageMax !== null ? `גיל ${ageMin}–${ageMax} כולל`
    : ageMax !== null ? `עד גיל ${ageMax} כולל` : `מגיל ${ageMin} ומעלה`;
  return {
    id: '__age', title: 'טווח גיל', teacherText: txt, severity: 'mandatory',
    cond: items.length === 1 ? items[0] : { op: 'all', items },
    failText: `הגיל שהוזן מחוץ לטווח של הנושא (${txt}).`,
    missingText: 'לא הוזן גיל.', status: 'published',
  };
}

/** כל השאלות שיש להציג למורה לנושא: גיל (אם יש גבול), שאלות הנושא, ושאלות הסף הכללי */
export function collectQuestions(topic: EngineTopic, general: RuleSet): Question[] {
  const out = new Map<string, Question>();
  if (ageRule(topic.ageMin, topic.ageMax)) out.set(AGE_QUESTION_ID, AGE_QUESTION);
  const used = new Set<string>();
  topic.rules.rules.filter(r => r.status === 'published' && !r.openPolicyId).forEach(r => condQuestionIds(r.cond, used));
  topic.rules.questions.forEach(q => { if (used.has(q.id)) out.set(q.id, q); });
  if (topic.generalThreshold) {
    const gu = new Set<string>();
    general.rules.filter(r => r.status === 'published' && !r.openPolicyId).forEach(r => condQuestionIds(r.cond, gu));
    general.questions.forEach(q => { if (gu.has(q.id) && !out.has(q.id)) out.set(q.id, q); });
  }
  return [...out.values()];
}

/**
 * חישוב תוצאת בדיקת מקרה. פועל בדפדפן בלבד, בלי שמירה ובלי רשת (סעיף 12.2).
 * סדר: החרגת נושא, גיל, כללי נושא, כללי סף כלליים, כיסוי, תוצאה.
 */
export function evaluateCase(topic: EngineTopic, general: RuleSet, answers: Answers, now: Date = new Date()): CaseResult {
  if (topic.policy === 'not_suitable') {
    return {
      verdict: 'topic_excluded', label: VERDICT_LABELS.topic_excluded,
      summary: 'הנושא מוחרג לפי הכלל הנוכחי במאגר. אפשר לבקש חריג אישי; בקשת חריג אינה היתר אוטומטי.',
      failed: [], missing: [], clarifications: [], warnings: [], passed: [], missingQuestions: [],
    };
  }

  const questions = new Map<string, Question>();
  const scoped: { rule: Rule; scope: Outcome['scope'] }[] = [];
  const age = ageRule(topic.ageMin, topic.ageMax);
  if (age) { questions.set(AGE_QUESTION_ID, AGE_QUESTION); scoped.push({ rule: age, scope: 'age' }); }
  topic.rules.questions.forEach(q => questions.set(q.id, q));
  topic.rules.rules.filter(r => r.status === 'published').forEach(r => scoped.push({ rule: r, scope: 'topic' }));
  if (topic.generalThreshold) {
    general.questions.forEach(q => { if (!questions.has(q.id)) questions.set(q.id, q); });
    general.rules.filter(r => r.status === 'published').forEach(r => scoped.push({ rule: r, scope: 'general' }));
  }

  const failed: Outcome[] = [], missing: Outcome[] = [], clar: Outcome[] = [], warnings: Outcome[] = [], passed: Outcome[] = [];
  const neededQ = new Set<string>();

  for (const { rule, scope } of scoped) {
    if (rule.openPolicyId) { clar.push(outcomeFor(rule, scope, 'clarification')); continue; }
    const r = evalCond(rule.cond, questions, answers, now);
    if (r === 'missing') condQuestionIds(rule.cond).forEach(id => {
      if (!isKnown(answers[id])) neededQ.add(id);
    });
    if (rule.severity === 'warning') {
      if (r === 'fail') warnings.push(outcomeFor(rule, scope, 'fail'));
      else if (r === 'missing') warnings.push(outcomeFor(rule, scope, 'missing'));
      continue;
    }
    (r === 'fail' ? failed : r === 'missing' ? missing : passed).push(outcomeFor(rule, scope, r));
  }

  const missingQuestions = [...neededQ].map(id => questions.get(id)).filter((q): q is Question => !!q);
  const cov = topic.coverage;
  const coverageOk = cov.level === 'full';
  let coverageNote: string | undefined;
  if (!coverageOk) {
    coverageNote = cov.level === 'partial'
      ? 'כיסוי הכללים לנושא זה חלקי: חלק מהתנאים טרם הוגדרו לחישוב. תוצאה חיובית ודאית אינה ניתנת.'
      : 'לנושא זה טרם הוגדרו כללי בדיקה למקרה. עצם היעדר כללים אינו מעיד שהתנאים מתקיימים.';
  }
  const unresolved = clar.length > 0 || !coverageOk || topic.policy === 'needs_review';

  let verdict: Verdict;
  if (failed.length) verdict = 'not_met';
  else if (unresolved) verdict = 'needs_review';
  else if (missing.length) verdict = 'missing';
  else verdict = topic.policy === 'conditional' ? 'conditional' : 'suitable';

  const summaryByVerdict: Record<Verdict, string> = {
    suitable: 'בתנאים שהוזנו, כל תנאי החובה המוגדרים לנושא מתקיימים והכיסוי מלא. זו תשובת התאמה לפי המאגר ולא אישור רשמי.',
    conditional: 'התנאים שהוזנו מתקיימים, והנושא מתאים בתנאים המפורטים בכרטיס. זו תשובת התאמה לפי המאגר ולא אישור רשמי.',
    not_met: 'לפחות תנאי חובה אחד אינו מתקיים לפי המאגר הנוכחי. ייתכן שנדרש חריג אישי מהאחראי.',
    missing: 'כללי הנושא מלאים, אך חסרות תשובות להשלמה לפני שאפשר לקבוע.',
    needs_review: 'לא ניתן לתת תשובה חיובית ודאית: יש תנאי שטרם הוכרע או שהכיסוי חלקי. זו אינה פסילה.',
    topic_excluded: '',
  };
  return {
    verdict, label: VERDICT_LABELS[verdict], summary: summaryByVerdict[verdict],
    failed, missing, clarifications: clar, warnings, passed, missingQuestions, coverageNote,
  };
}
