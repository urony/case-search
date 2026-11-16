import { condQuestionIds } from './evaluate';
import { Cond, Coverage, Question, RuleSet } from './types';

export interface Issue { level: 'error' | 'warning'; message: string }

function walk(c: Cond, fn: (leaf: Extract<Cond, { q: string }>) => void) {
  if ('op' in c) {
    if (c.op === 'not') walk(c.item, fn);
    else c.items.forEach(i => walk(i, fn));
  } else fn(c);
}

/**
 * בדיקת תקינות של ערכת כללים לפני פרסום (סעיף 10.1 ו"מפרט ביצועי למנוע").
 * מזהה שדות חסרים, סתירות בסיסיות והתייחסות לשאלות שאינן קיימות.
 */
export function validateRuleSet(
  rs: RuleSet,
  coverage: Coverage,
  bounds: { ageMin: number | null; ageMax: number | null },
): Issue[] {
  const issues: Issue[] = [];
  const err = (m: string) => issues.push({ level: 'error', message: m });
  const warn = (m: string) => issues.push({ level: 'warning', message: m });

  const qMap = new Map<string, Question>();
  for (const q of rs.questions) {
    if (!q.id.trim()) err('שאלה ללא מזהה.');
    if (q.id.startsWith('__')) err(`המזהה "${q.id}" שמור למערכת.`);
    if (qMap.has(q.id)) err(`מזהה שאלה כפול: ${q.id}`);
    qMap.set(q.id, q);
    if (!q.label.trim()) err(`לשאלה ${q.id} חסר נוסח.`);
    if (q.type === 'choice' && (!q.choices || q.choices.length < 2)) err(`בשאלת בחירה ${q.id} נדרשות לפחות שתי אפשרויות.`);
  }
  const ruleIds = new Set<string>();
  for (const r of rs.rules) {
    if (ruleIds.has(r.id)) err(`מזהה כלל כפול: ${r.id}`);
    ruleIds.add(r.id);
    if (!r.title.trim()) err(`לכלל ${r.id} חסרה כותרת.`);
    if (!r.teacherText.trim()) err(`לכלל ${r.id} חסר נוסח למורה.`);
    if (r.openPolicyId) continue; // לא מחושב
    if (('op' in r.cond) && r.cond.op !== 'not' && r.cond.items.length === 0) err(`בכלל ${r.id} תנאי ריק.`);
    walk(r.cond, leaf => {
      const q = qMap.get(leaf.q);
      if (!q) { err(`בכלל ${r.id}: השאלה "${leaf.q}" אינה קיימת.`); return; }
      if (q.type === 'yesno' && !(leaf.cmp === 'eq' || leaf.cmp === 'neq')) err(`בכלל ${r.id}: בשאלת כן/לא מותרת רק השוואת שוויון.`);
      if (q.type === 'yesno' && leaf.value !== 'yes' && leaf.value !== 'no') err(`בכלל ${r.id}: ערך ההשוואה בשאלת כן/לא חייב להיות yes או no.`);
      if (q.type === 'number' && typeof leaf.value !== 'number') err(`בכלל ${r.id}: נדרש מספר.`);
      if (q.type === 'date') {
        if (typeof leaf.value !== 'number') err(`בכלל ${r.id}: בשאלת תאריך נדרש מספר ויחידת זמן.`);
        if (!leaf.unit) err(`בכלל ${r.id}: חסרה יחידת זמן (שנים או חודשים).`);
      }
      if (q.type === 'choice') {
        const vals = Array.isArray(leaf.value) ? leaf.value : [String(leaf.value)];
        const known = new Set((q.choices ?? []).map(c => c.value));
        vals.forEach(v => { if (!known.has(v)) err(`בכלל ${r.id}: הערך "${v}" אינו אחת האפשרויות בשאלה ${q.id}.`); });
      }
      if (leaf.cmp === 'between') {
        if (typeof leaf.value !== 'number' || typeof leaf.value2 !== 'number') err(`בכלל ${r.id}: בטווח נדרשים גבול תחתון ועליון.`);
        else if (leaf.value > leaf.value2) err(`בכלל ${r.id}: הגבול התחתון גדול מהעליון.`);
      }
    });
    condQuestionIds(r.cond);
  }
  if (bounds.ageMin !== null && bounds.ageMax !== null && bounds.ageMin > bounds.ageMax) err('גיל מינימום גדול מגיל מקסימום.');

  if (coverage.level === 'full') {
    if (!coverage.approvedBy) err('כיסוי "מלא" דורש אישור מנהל (שם המאשר).');
    if (!coverage.reason.trim()) err('כיסוי "מלא" דורש נימוק.');
    const hasMandatory = rs.rules.some(r => r.status === 'published' && r.severity === 'mandatory') || bounds.ageMin !== null || bounds.ageMax !== null;
    if (!hasMandatory && !coverage.noCaseRulesNeeded) err('כיסוי מלא ללא כללי חובה דורש הכרעה מפורשת שאין צורך בשאלות מקרה.');
    if (rs.rules.some(r => r.openPolicyId && r.status === 'published')) err('כיסוי מלא אינו אפשרי כל עוד יש כלל שמסומן "טרם הוכרע".');
  }
  if (coverage.level !== 'full' && coverage.noCaseRulesNeeded) warn('סומן שאין צורך בשאלות מקרה אך הכיסוי אינו מלא.');
  if (rs.rules.length === 0 && coverage.level === 'partial') warn('כיסוי חלקי ללא כללים: מומלץ לסמן "חסר".');
  return issues;
}
