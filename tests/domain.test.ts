import { describe, expect, it } from 'vitest';
import seed from '../data/seed.json';
import systemMap from '../data/system-map.json';
import aliases from '../data/aliases.json';
import overrides from '../data/seed-overrides.json';
import { planSeedImport, SeedAux, SeedFile, SeedRecord } from '../src/domain/seedImport';
import { buildIndex, searchTopics } from '../src/domain/search';
import { normalize } from '../src/domain/normalize';
import { academicYear, hebrewYearLabel } from '../src/domain/years';
import { evaluateCase } from '../src/engine/evaluate';
import { DEFAULT_GENERAL_RULES } from '../src/engine/general';
import { AGE_QUESTION_ID } from '../src/engine/types';

const aux: SeedAux = {
  systems: systemMap.systems, systemMap: systemMap.map, placeholders: systemMap.placeholders,
  aliases: aliases as unknown as Record<string, string[]>, overrides: overrides as unknown as SeedAux['overrides'],
};
const seedFile = seed as unknown as SeedFile;
const NOW = 1_800_000_000_000;

describe('ייבוא 114 רשומות', () => {
  const plan = planSeedImport(seedFile, new Map(), aux, NOW);
  const byId = new Map(plan.createTopics.map(t => [t.id, t]));

  it('נוצרים 114 נושאים ו־114 רשומות מקור, ללא כפילות מזהים', () => {
    expect(plan.createTopics).toHaveLength(114);
    expect(plan.upsertSeedRecords).toHaveLength(114);
    expect(byId.size).toBe(114);
  });
  it('סטטוס המיפוי מתורגם ואף רשומה אינה מופיעה כ"מאושרת גורפת": כיסוי לא מלא בכולן', () => {
    expect(plan.createTopics.every(t => t.coverage.level !== 'full')).toBe(true);
    expect(plan.createTopics.filter(t => t.policy === 'not_suitable')).toHaveLength(13);
    expect(plan.createTopics.filter(t => t.policy === 'needs_review')).toHaveLength(18);
  });
  it('sourceCondition ו־reviewNote נשמרים בכל רשומה', () => {
    expect(plan.createTopics.every(t => t.sourceCondition.length > 0 && t.reviewNote.length > 0)).toBe(true);
  });
  it('סוג הרשומה אינו מוכרע אוטומטית', () => {
    expect(plan.createTopics.every(t => t.kind === 'unclassified')).toBe(true);
    expect(byId.get('t-S094')!.kindSuggestion).toBe('category');
  });
  it('גיל 18 כולל רק ל־S020, S034, S064; לאחרות אין מגבלה (R14)', () => {
    const aged = plan.createTopics.filter(t => t.ageMax !== null).map(t => t.seedIds[0]).sort();
    expect(aged).toEqual(['S020', 'S034', 'S064']);
    expect(byId.get('t-S020')!.ageMax).toBe(18);
  });
  it('מחרוזות שאינן מערכת אינן הופכות לקטגוריה; מסומנות לבדיקה, והמקור נשמר', () => {
    const t = byId.get('t-S076')!;
    expect(t.systems).toEqual(['trauma']);
    expect(t.systemsNeedReview).toBe(true);
    expect(t.systemsRaw).toContain('לפי האיבר הנפגע');
    expect(byId.get('t-S113')!.systems).toEqual([]);
  });
  it('כל מערכת ממופה למילון קיים', () => {
    const ids = new Set(systemMap.systems.map(s => s.id));
    expect(plan.createTopics.every(t => t.systems.every(s => ids.has(s)))).toBe(true);
    // שמות הקבצים המקוריים לא אבדו: כל מחרוזת מקור ממופה או מוכרת כ-placeholder
    const unknown = new Set<string>();
    seedFile.entries.forEach(e => e.proposedSystems.forEach(s => { if (!(s in systemMap.map) && !systemMap.placeholders.includes(s)) unknown.add(s); }));
    expect([...unknown]).toEqual([]);
  });
  it('COPD ואמפיזמה באותה משפחת כפילות; צליאק וקרוהן לא (T18)', () => {
    expect(byId.get('t-S054')!.familyId).toBe(byId.get('t-S055')!.familyId);
    expect(byId.get('t-S034')!.familyId).not.toBe(byId.get('t-S035')!.familyId);
    expect(byId.get('t-S035')!.familyId).not.toBe(byId.get('t-S114')!.familyId);
  });
  it('כל קשר מצביע על נושא קיים', () => {
    for (const t of plan.createTopics) for (const r of t.relations) expect(byId.has(r.targetId), `${t.id} -> ${r.targetId}`).toBe(true);
  });

  describe('ייבוא חוזר (T33)', () => {
    const existing = new Map<string, SeedRecord>(plan.upsertSeedRecords.map(r => [r.seedId, r]));
    it('ייבוא זהה אינו יוצר דבר', () => {
      const p2 = planSeedImport(seedFile, existing, aux, NOW + 1, new Set(byId.keys()));
      expect(p2.createTopics).toHaveLength(0);
      expect(p2.suggestions).toHaveLength(0);
      expect(p2.skipped).toHaveLength(114);
    });
    it('שינוי במקור יוצר הצעת עדכון ואינו דורס נושא ערוך', () => {
      const changed: SeedFile = { ...seedFile, entries: seedFile.entries.map(e => e.seedId === 'S001' ? { ...e, sourceCondition: 'ניסוח חדש' } : e) };
      const p2 = planSeedImport(changed, existing, aux, NOW + 2, new Set(byId.keys()));
      expect(p2.createTopics).toHaveLength(0);
      expect(p2.suggestions).toHaveLength(1);
      expect(p2.suggestions[0].changedFields).toEqual(['sourceCondition']);
    });
    it('נושא שמנהל מיזג: הקשר נשמר ואינו נוצר מחדש', () => {
      const merged = new Map(existing);
      merged.set('S069', { ...existing.get('S069')!, topicIds: ['t-S068'] });
      const ids = new Set(byId.keys()); ids.delete('t-S069'); // המנהל מחק/מיזג את הנושא
      const p2 = planSeedImport(seedFile, merged, aux, NOW + 3, ids);
      expect(p2.createTopics).toHaveLength(0);
    });
    it('רשומה חדשה במקור נוצרת בלבד', () => {
      const extra: SeedFile = { ...seedFile, entries: [...seedFile.entries, { seedId: 'S115', he: 'חדש', en: 'New', proposedSystems: ['עור'], mappingStatus: 'בירור', sourceCondition: 'x', reviewNote: 'y', sourcePages: '1' }] };
      const p2 = planSeedImport(extra, existing, aux, NOW + 4, new Set(byId.keys()));
      expect(p2.createTopics.map(t => t.id)).toEqual(['t-S115']);
    });
  });

  describe('חיפוש (T03, T18)', () => {
    const index = buildIndex(plan.createTopics);
    const top = (q: string) => searchTopics(index, q)[0]?.topic.id;
    it('התקף לב מפנה לאוטם', () => expect(top('התקף לב')).toBe('t-S001'));
    it('COPD וגם C.O.P.D.', () => { expect(top('COPD')).toBe('t-S054'); expect(top('C.O.P.D.')).toBe('t-S054'); });
    it('סוכרת נעורים מפנה לסוכרת מסוג 1', () => expect(top('סוכרת נעורים')).toBe('t-S020'));
    it('Celiac וגם Coeliac', () => { expect(top('Celiac')).toBe('t-S034'); expect(top('Coeliac')).toBe('t-S034'); });
    it('קרוהן וקוליטיס כיבית נשארות שונות', () => {
      expect(top('קרוהן')).toBe('t-S035');
      expect(top('קוליטיס כיבית')).toBe('t-S114');
      expect(top('Crohn')).toBe('t-S035');
    });
    it('שגיאת כתיב מציגה התאמה משוערת ולא מחליפה בשקט', () => {
      const r = searchTopics(index, 'אמפיזימה');
      expect(r.length).toBeGreaterThan(0);
      expect(r[0].match).toBe('approx');
    });
    it('אותיות סופיות ופיסוק אינם משפיעים', () => expect(normalize('מג׳ור')).toBe(normalize('מגור')));
    it('מסנן גיל: סוכרת 1 לא מופיעה לגיל 19, כן לגיל 18', () => {
      const ids = (age: number) => searchTopics(index, '', { age }).map(h => h.topic.id);
      expect(ids(19)).not.toContain('t-S020');
      expect(ids(18)).toContain('t-S020');
    });
    it('נושא שהוסר מפרסום אינו מופיע', () => {
      const idx = buildIndex(plan.createTopics.map(t => t.id === 't-S001' ? { ...t, publish: 'unpublished' as const } : t));
      expect(searchTopics(idx, 'אוטם')).toHaveLength(0);
    });
  });

  describe('אין התאמה חיובית ממיפוי ראשוני (T32, T33)', () => {
    it('סוכרת 1 בגיל 17: דורש בירור ולא "מתאים"', () => {
      const t = byId.get('t-S020')!;
      const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { [AGE_QUESTION_ID]: 17, dx_date: { year: 2027, month: 1 }, clin_now: 'yes' }, new Date(2027, 10, 1));
      expect(r.verdict).toBe('needs_review');
    });
    it('סוכרת 1 בגיל 19: לא עומד בכלל הנוכחי', () => {
      const t = byId.get('t-S020')!;
      const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { [AGE_QUESTION_ID]: 19 }, new Date(2027, 10, 1));
      expect(r.verdict).toBe('not_met');
    });
    it('מחלה מוחרגת (כבד שומני) מוצגת "לא מתאים לפי הכלל הנוכחי"', () => {
      expect(evaluateCase(byId.get('t-S098')!, DEFAULT_GENERAL_RULES, {}).verdict).toBe('topic_excluded');
    });
    it('אף נושא מהמיפוי אינו נותן "מתאים" בבדיקה ריקה או מלאה', () => {
      for (const t of plan.createTopics) {
        const r = evaluateCase(t, DEFAULT_GENERAL_RULES, { [AGE_QUESTION_ID]: 15, dx_date: { year: 2027, month: 6 }, clin_now: 'yes' }, new Date(2027, 10, 1));
        expect(['suitable', 'conditional']).not.toContain(r.verdict);
      }
    });
  });
});

describe('שנות לימודים', () => {
  it('תשפ״ח = ספטמבר 2027 עד אוגוסט 2028', () => {
    expect(hebrewYearLabel(5788)).toBe('תשפ״ח');
    const y = academicYear(2027);
    expect(y.id).toBe('2027-28');
    expect(y.label).toBe('תשפ״ח');
  });
  it('תשפ״ז ותשפ״ט', () => {
    expect(academicYear(2026).label).toBe('תשפ״ז');
    expect(academicYear(2028).label).toBe('תשפ״ט');
  });
});
