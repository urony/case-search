import { academicYear } from '../domain/years';
import type { SchoolYearHistory } from '../domain/types';
import type { Api } from '../services/api';

export function startYearOf(yearId: string): number { return parseInt(yearId.slice(0, 4), 10); }

/** טוען עד עשר שנות היסטוריה של מוסד (get לפי קוד ושנה). חסר מסמך = אין היסטוריה לאותה שנה. */
export async function loadSchoolHistories(api: Api, schoolId: string, currentYearId: string, years = 10): Promise<{ histories: SchoolYearHistory[]; currentYearId: string; prevYearId: string }> {
  const start = startYearOf(currentYearId);
  const out: SchoolYearHistory[] = [];
  for (let k = 0; k < years; k++) {
    const y = academicYear(start - k);
    try { const h = await api.getSchoolHistory(schoolId, y.id); if (h) out.push(h); } catch { /* שנה ללא נתונים */ }
  }
  return { histories: out, currentYearId, prevYearId: academicYear(start - 1).id };
}

export const HISTORY_STATE_LABEL: Record<string, string> = {
  done: 'בוצע',
  cancelled: 'בוטל',
  approved_not_done: 'אושר ולא בוצע',
  declared: 'נבחר במחזור הפעיל',
};
