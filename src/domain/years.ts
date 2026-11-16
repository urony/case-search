import type { AcademicYear } from './types';

const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];

/** שנה עברית (למשל 5788) לתווית בגימטריה ללא האלפים: תשפ״ח */
export function hebrewYearLabel(hebYear: number): string {
  const n = hebYear % 1000;
  const h = Math.floor(n / 100), rest = n % 100;
  let tens = Math.floor(rest / 10), ones = rest % 10;
  let s = HUNDREDS[h];
  if (rest === 15) s += 'טו';
  else if (rest === 16) s += 'טז';
  else { s += TENS[tens] + ONES[ones]; }
  void tens; void ones;
  return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
}

/** שנת לימודים שמתחילה בספטמבר של startYear. מזהה: "2027-28". תשפ״ח = ספטמבר 2027 עד אוגוסט 2028. */
export function academicYear(startYear: number): AcademicYear {
  return {
    id: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    label: hebrewYearLabel(startYear + 3761),
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-08-31`,
    cycleEnd: null,
    closed: false,
  };
}

export function currentStartYear(now: Date = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}
