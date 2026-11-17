import seed from '../../data/seed.json';
import systemMap from '../../data/system-map.json';
import aliases from '../../data/aliases.json';
import overrides from '../../data/seed-overrides.json';
import { DEFAULT_GENERAL_RULES } from '../engine/general';
import { planSeedImport, SeedAux, SeedFile } from '../domain/seedImport';
import { academicYear, currentStartYear } from '../domain/years';
import type { AcademicYear, Catalog, Settings, TagDef } from '../domain/types';

export const SEED = seed as unknown as SeedFile;

export const SEED_AUX: SeedAux = {
  systems: systemMap.systems,
  systemMap: systemMap.map,
  placeholders: systemMap.placeholders,
  aliases: aliases as unknown as Record<string, string[]>,
  overrides: overrides as unknown as SeedAux['overrides'],
};

/** תגיות לדוגמה כמילון ראשוני לניהול (סעיף 7.2). אינן משויכות לנושאים עד אישור מנהל. */
export const DEFAULT_TAGS: TagDef[] = [
  { id: 'autoimmune', label: 'אוטואימוני' },
  { id: 'hereditary', label: 'תורשתי' },
  { id: 'genetic', label: 'גנטי' },
  { id: 'congenital', label: 'מולד' },
  { id: 'infectious', label: 'זיהומי' },
  { id: 'tumor', label: 'גידול' },
  { id: 'malignant', label: 'ממאיר' },
  { id: 'injury', label: 'פגיעה' },
  { id: 'chronic', label: 'כרוני' },
  { id: 'acute', label: 'אקוטי' },
];

export const OFFICIAL_FORM_URL =
  'https://script.google.com/macros/s/AKfycbw4E2k6vQoanVF6HcAPatqXdXwkVm-Xl7WnTQhlbiioY1_ljk5dZogBFzUHDV-Bm4-pHg/exec';

export function defaultSettings(now: Date = new Date()): Settings {
  return {
    officialFormUrl: OFFICIAL_FORM_URL,
    responsibleEmail: '',
    responsibleName: '',
    responseDueDays: 7,
    submissionNote: 'הגשת נושאים נעשית לפני העבודה המעשית ועד סוף אוקטובר של כיתה י״ב. בקשה מאוחרת מופנית לאחראי אישית; האתר אינו מעניק פטור אוטומטי מהמועד.',
    currentYearId: academicYear(currentStartYear(now)).id,
  };
}

export function defaultYears(now: Date = new Date()): AcademicYear[] {
  const s = currentStartYear(now);
  return [-1, 0, 1].map(d => academicYear(s + d));
}

/** קטלוג מובנה (מקובץ ה-seed) לשימוש כשאין שירות נתונים: קריאה בלבד. */
export function buildBundledCatalog(now = Date.now()): Catalog {
  const plan = planSeedImport(SEED, new Map(), SEED_AUX, now);
  return {
    topics: plan.createTopics,
    generalRules: DEFAULT_GENERAL_RULES,
    systems: SEED_AUX.systems,
    tags: DEFAULT_TAGS,
    settings: defaultSettings(new Date(now)),
    years: defaultYears(new Date(now)),
    generatedAt: now,
    origin: 'bundled',
  };
}
