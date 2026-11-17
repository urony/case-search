import type { AllowedTeacher, School } from './types';

/** מנתח CSV פשוט עם מירכאות. מזהה מפריד פסיק או נקודה־פסיק. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

export interface SchoolImportRow { line: number; school: School; status: 'new' | 'update' | 'error' | 'duplicate_in_file'; message?: string }

const CODE_H = ['קוד', 'קוד מוסד', 'סמל', 'סמל מוסד', 'code', 'id', 'school_id'];
const NAME_H = ['שם', 'שם מוסד', 'name', 'school_name'];
const CITY_H = ['יישוב', 'ישוב', 'עיר', 'city'];

/** תצוגה מקדימה של ייבוא מוסדות: מזהה כפילויות ושגיאות לפני כתיבה. */
export function previewSchoolImport(text: string, existing: Map<string, School>): SchoolImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex(h => names.includes(h));
  let ci = col(CODE_H), ni = col(NAME_H), yi = col(CITY_H);
  let start = 1;
  if (ci < 0 || ni < 0) { ci = 0; ni = 1; yi = 2; start = 0; } // ללא כותרות: קוד, שם, יישוב
  const seen = new Set<string>();
  const out: SchoolImportRow[] = [];
  for (let r = start; r < rows.length; r++) {
    const cells = rows[r];
    const id = (cells[ci] ?? '').trim(), name = (cells[ni] ?? '').trim(), city = (yi >= 0 ? (cells[yi] ?? '') : '').trim();
    const school: School = { id, name, city, active: true };
    const line = r + 1;
    if (!/^[A-Za-z0-9א-ת_-]{2,20}$/.test(id)) { out.push({ line, school, status: 'error', message: 'קוד מוסד חסר או לא תקין' }); continue; }
    if (!name) { out.push({ line, school, status: 'error', message: 'שם מוסד חסר' }); continue; }
    if (seen.has(id)) { out.push({ line, school, status: 'duplicate_in_file', message: 'קוד כפול בקובץ' }); continue; }
    seen.add(id);
    out.push({ line, school, status: existing.has(id) ? 'update' : 'new' });
  }
  return out;
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
export const normEmail = (e: string) => e.trim().toLowerCase();

export interface TeacherImportRow {
  line: number; email: string; name: string; schoolIds: string[];
  status: 'new' | 'update' | 'unchanged' | 'skip_revoked' | 'error' | 'duplicate_in_file'; message?: string;
}
const EMAIL_H = ['מייל', 'כתובת מייל', 'דוא"ל', 'דואל', 'email', 'e-mail', 'mail'];
const TNAME_H = ['שם', 'שם מורה', 'name', 'full_name'];
const TSCHOOL_H = ['מוסד', 'קוד מוסד', 'קודי מוסד', 'סמל מוסד', 'school', 'school_id', 'schools'];

/**
 * תצוגה מקדימה לייבוא מורים מאושרים: מייל (חובה), שם (רשות), קודי מוסד מופרדים ב־| או רווח (רשות, חייבים להיות קיימים).
 * מורה שהגישה שלו בוטלה אינו משוחזר בייבוא: שחזור הוא פעולה מפורשת.
 */
export function previewTeacherImport(text: string, existing: Map<string, AllowedTeacher>, schools: Set<string>): TeacherImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex(h => names.includes(h));
  let ei = col(EMAIL_H), ni = col(TNAME_H), si = col(TSCHOOL_H);
  let start = 1;
  if (ei < 0) { ei = 0; ni = 1; si = 2; start = 0; } // ללא כותרות: מייל, שם, מוסדות
  const seen = new Set<string>();
  const out: TeacherImportRow[] = [];
  for (let r = start; r < rows.length; r++) {
    const c = rows[r];
    const email = normEmail(c[ei] ?? ''), name = (ni >= 0 ? (c[ni] ?? '') : '').trim().slice(0, 80);
    const schoolIds = (si >= 0 ? (c[si] ?? '') : '').split(/[|\s]+/).map(x => x.trim()).filter(Boolean);
    const line = r + 1;
    const base = { line, email, name, schoolIds };
    if (!EMAIL_RE.test(email)) { out.push({ ...base, status: 'error', message: 'כתובת מייל לא תקינה' }); continue; }
    const bad = schoolIds.filter(s => !schools.has(s));
    if (bad.length) { out.push({ ...base, status: 'error', message: `קוד מוסד לא קיים: ${bad.join(', ')}` }); continue; }
    if (seen.has(email)) { out.push({ ...base, status: 'duplicate_in_file', message: 'כתובת כפולה בקובץ' }); continue; }
    seen.add(email);
    const ex = existing.get(email);
    if (!ex) { out.push({ ...base, status: 'new' }); continue; }
    if (!ex.active) { out.push({ ...base, status: 'skip_revoked', message: 'הגישה בוטלה. לשחזור יש לפעול ידנית' }); continue; }
    const same = ex.name === (name || ex.name) && [...ex.schoolIds].sort().join() === [...schoolIds].sort().join();
    out.push({ ...base, status: same ? 'unchanged' : 'update' });
  }
  return out;
}
