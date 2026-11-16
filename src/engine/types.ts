// מנוע כללים הצהרתי ומוגבל (סעיף 10 במפרט). אין eval ואין קוד חופשי: רק מבני נתונים סגורים.

export type QType = 'yesno' | 'number' | 'date' | 'choice';

export interface Question {
  id: string;
  label: string;
  help?: string;
  type: QType;
  choices?: { value: string; label: string }[];
  unit?: string;
}

/** ערך תשובה. היעדר ערך או 'unknown' = "לא ידוע" ואינו שלילה (סעיף 10.1). */
export type AnswerValue = 'yes' | 'no' | 'unknown' | number | { year: number; month: number } | { choice: string };
export type Answers = Record<string, AnswerValue | undefined>;

export type Cmp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'in';

export type Cond =
  | { op: 'all'; items: Cond[] }
  | { op: 'any'; items: Cond[] }
  | { op: 'not'; item: Cond }
  | { q: string; cmp: Cmp; value: string | number | string[]; value2?: number; unit?: 'years' | 'months' };

export type RuleSeverity = 'mandatory' | 'warning';
export type RuleStatus = 'draft' | 'published' | 'disabled';

export interface Rule {
  id: string;
  title: string;
  /** נוסח למורה */
  teacherText: string;
  severity: RuleSeverity;
  cond: Cond;
  /** מה מוצג כשהתנאי לא מתקיים / כשחסר מידע */
  failText?: string;
  missingText?: string;
  /** אם מוגדר: התנאי טרם הוכרע מקצועית ואינו מחושב. התוצאה "דורש בירור" ולא פסילה. */
  openPolicyId?: string;
  source?: string;
  status: RuleStatus;
}

export interface RuleSet {
  questions: Question[];
  rules: Rule[];
}

export type CoverageLevel = 'full' | 'partial' | 'none';
export interface Coverage {
  level: CoverageLevel;
  reason: string;
  approvedBy?: string;
  approvedAt?: number;
  /** הכרעת מנהל מפורשת שאין צורך בשאלות מקרה לנושא */
  noCaseRulesNeeded?: boolean;
}

export type Policy = 'suitable' | 'conditional' | 'not_suitable' | 'needs_review';

export interface EngineTopic {
  id: string;
  he: string;
  policy: Policy;
  ageMin: number | null;
  ageMax: number | null;
  coverage: Coverage;
  rules: RuleSet;
  /** האם חל כלל הסף הכללי (סעיף 11.1) */
  generalThreshold: boolean;
}

export type Tri = 'pass' | 'fail' | 'missing';

export interface Outcome {
  ruleId: string;
  title: string;
  teacherText: string;
  severity: RuleSeverity;
  scope: 'age' | 'general' | 'topic';
  state: 'pass' | 'fail' | 'missing' | 'clarification';
  text?: string;
}

export type Verdict =
  | 'suitable' // מתאים כנושא (כיסוי מלא + עמידה בכל תנאי החובה)
  | 'conditional' // מתאים בתנאים
  | 'not_met' // לא עומד בכלל הנוכחי
  | 'missing' // חסר מידע
  | 'needs_review' // דורש בירור
  | 'topic_excluded'; // הנושא עצמו אינו מתאים לפי הכלל הנוכחי

export interface CaseResult {
  verdict: Verdict;
  label: string;
  summary: string;
  failed: Outcome[];
  missing: Outcome[];
  clarifications: Outcome[];
  warnings: Outcome[];
  passed: Outcome[];
  /** שאלות שיש עדיין להשלים */
  missingQuestions: Question[];
  coverageNote?: string;
}

export const AGE_QUESTION_ID = '__age';
