import type { RecruitmentSource, RequestDoc, SchoolYearHistory, Settings, SourceKind } from './types';

// ───────── מקורות איתור: קלט וקישורים (סעיף 13.3) ─────────

export const SOURCE_KINDS: { id: SourceKind; label: string }[] = [
  { id: 'association', label: 'עמותה' },
  { id: 'website', label: 'אתר' },
  { id: 'facebook', label: 'קבוצת פייסבוק' },
  { id: 'social', label: 'חשבון או קבוצה ברשת חברתית' },
  { id: 'professional', label: 'איש מקצוע שמשתף פעולה' },
  { id: 'phone', label: 'טלפון' },
  { id: 'free', label: 'הסבר חופשי' },
];

/** מקבל רק http/https. דוחה javascript:, data:, vbscript: וכל סכמה אחרת. מחזיר כתובת מנורמלת או null. */
export function safeWebUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

/** טלפון ישראלי או בינלאומי פשוט. מחזיר ספרות (עם + אופציונלי) או null. */
export function safePhone(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (!/^[+0-9()\-\s.]{7,20}$/.test(s)) return null;
  const digits = s.replace(/[^\d+]/g, '');
  const count = digits.replace(/\D/g, '').length;
  return count >= 7 && count <= 15 ? digits : null;
}

export interface SourceInput {
  topicId: string; title: string; kind: SourceKind; text: string; url: string; phone: string; region: string; population: string;
  confirmNoPatientData: boolean;
}
export interface SourceCheck { ok: boolean; errors: string[]; warnings: string[]; clean?: Omit<SourceInput, 'confirmNoPatientData'> }

export function looksLikePersonalData(text: string): boolean {
  return /\b\d{9}\b/.test(text) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(text);
}

export function checkSourceInput(i: SourceInput): SourceCheck {
  const errors: string[] = [], warnings: string[] = [];
  const title = i.title.trim(), text = i.text.trim();
  if (!i.topicId) errors.push('לא נבחר נושא.');
  if (title.length < 3) errors.push('נדרשת כותרת ברורה (לפחות 3 תווים).');
  if (title.length > 120) errors.push('הכותרת ארוכה מדי.');
  if (text.length > 1500) errors.push('הטקסט ארוך מדי (עד 1,500 תווים).');
  if (!i.confirmNoPatientData) errors.push('יש לאשר שלא הוספו פרטי מטופל.');
  let url = '';
  if (i.url.trim()) {
    const u = safeWebUrl(i.url);
    if (!u) errors.push('כתובת האתר אינה תקינה. מותרים רק קישורי http או https.');
    else url = u;
  }
  let phone = '';
  if (i.phone.trim()) {
    const p = safePhone(i.phone);
    if (!p) errors.push('מספר הטלפון אינו תקין.');
    else phone = p;
  }
  if (!url && !phone && text.length < 10) errors.push('יש להוסיף כתובת, טלפון או הסבר של לפחות 10 תווים.');
  if (looksLikePersonalData(`${title} ${text} ${i.region} ${i.population}`)) warnings.push('נראה שהטקסט מכיל מספר זיהוי או כתובת מייל. המאגר מיועד למקורות סיוע בלבד, לא לפרטי אנשים.');
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors, warnings, clean: { topicId: i.topicId, title, kind: i.kind, text, url, phone, region: i.region.trim().slice(0, 80), population: i.population.trim().slice(0, 120) } };
}

export function visibleSources(all: RecruitmentSource[]): RecruitmentSource[] {
  return all.filter(s => s.visible);
}

// ───────── חריג אישי: mailto כללי בלבד (סעיף 15.2) ─────────

/** כותרת כללית בלבד: שם הנושא. אין גוף הודעה ואין שום פרט קליני. */
export function buildExceptionMailto(settings: Pick<Settings, 'responsibleEmail'>, topicHe: string): string | null {
  const to = settings.responsibleEmail.trim();
  if (!to) return null;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`פנייה בנושא חריג: ${topicHe}`)}`;
}

// ───────── בקשות: יעד טיפול (סעיף 18.3) ─────────

export function dueAtFor(createdAt: number, days: number): number {
  return createdAt + Math.max(1, days) * 24 * 60 * 60 * 1000;
}
export function isOverdue(r: Pick<RequestDoc, 'status' | 'dueAt'>, now: number): boolean {
  return (r.status === 'open') && now > r.dueAt; // "ממתין למורה" אינו נספר כאיחור של המנהל; איחור אינו משנה תוצאה
}

// ───────── כפילות נושאים במוסד (סעיף 16.3) ─────────

export type DuplicateWarning =
  | { kind: 'prev_year_done'; topicHe: string }
  | { kind: 'same_cycle'; topicHe: string }
  | { kind: 'earlier_years_info'; topicHe: string; yearId: string }
  | { kind: 'no_history' };

/**
 * אזהרות כפילות לפי משפחת נושא, לא לפי כותרת. אינן חוסמות.
 * - נושא שבוצע בשנה הקודמת: אזהרה (T16).
 * - נושא שאושר אך לא בוצע או בוטל: אינו נחשב כבוצע (T17).
 * - שנים קודמות נוספות: מידע בלבד, לא חסימה.
 */
export function duplicateWarnings(args: {
  familyId: string; ownGroupId?: string; currentYearId: string; prevYearId: string;
  history: SchoolYearHistory[];
}): DuplicateWarning[] {
  const out: DuplicateWarning[] = [];
  const byYear = new Map(args.history.map(h => [h.yearId, h]));
  if (!byYear.has(args.prevYearId)) out.push({ kind: 'no_history' });
  for (const h of args.history) {
    for (const it of h.items) {
      if (it.familyId !== args.familyId) continue;
      if (h.yearId === args.prevYearId && it.state === 'done') out.push({ kind: 'prev_year_done', topicHe: it.topicHe });
      else if (h.yearId === args.currentYearId && it.groupId !== args.ownGroupId && it.state !== 'cancelled') out.push({ kind: 'same_cycle', topicHe: it.topicHe });
      else if (h.yearId !== args.prevYearId && h.yearId !== args.currentYearId && it.state === 'done') out.push({ kind: 'earlier_years_info', topicHe: it.topicHe, yearId: h.yearId });
    }
  }
  return out;
}
