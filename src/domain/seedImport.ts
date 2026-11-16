import type { Coverage } from '../engine/types';
import type { Kind, Policy, Relation, SystemDef, Topic } from './types';

export interface SeedEntry {
  seedId: string; he: string; en: string; proposedSystems: string[];
  mappingStatus: string; sourceCondition: string; reviewNote: string; sourcePages: string;
}
export interface SeedFile { schemaVersion: number; description: string; entries: SeedEntry[] }

export interface SeedAux {
  systems: SystemDef[];
  systemMap: Record<string, string>;
  placeholders: string[];
  aliases: Record<string, string[]>;
  overrides: {
    ageMax?: Record<string, number>;
    family?: Record<string, string>;
    kindSuggestion?: Record<string, Kind>;
    relations?: Record<string, Relation[]>;
  };
}

/** רשומת מקור גולמית שנשמרת בנפרד מהנושא, כדי שייבוא חוזר לא יאבד שינויי מנהל (סעיף 28). */
export interface SeedRecord { seedId: string; raw: SeedEntry; hash: string; topicIds: string[]; importedAt: number; schemaVersion: number }

export interface SeedUpdateSuggestion {
  id: string; type: 'seed_update'; seedId: string; topicIds: string[]; changedFields: string[]; createdAt: number; state: 'open';
}

export interface ImportPlan {
  createTopics: Topic[];
  upsertSeedRecords: SeedRecord[];
  suggestions: SeedUpdateSuggestion[];
  skipped: string[];
}

const POLICY_MAP: Record<string, Policy> = {
  'מופיע': 'suitable',
  'מותנה': 'conditional',
  'בירור': 'needs_review',
  'לא מאושר': 'not_suitable',
};

export function hashEntry(e: SeedEntry): string {
  const s = JSON.stringify([e.seedId, e.he, e.en, e.proposedSystems, e.mappingStatus, e.sourceCondition, e.reviewNote, e.sourcePages]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function topicIdFor(seedId: string) { return `t-${seedId}`; }

function mapSystems(raw: string[], aux: SeedAux): { ids: string[]; needsReview: boolean } {
  const ids: string[] = [];
  let needsReview = false;
  for (const r of raw) {
    const id = aux.systemMap[r];
    if (id) { if (!ids.includes(id)) ids.push(id); }
    else needsReview = true; // כולל מחרוזות "לפי האיבר הנפגע" וכדומה: לא ממציאים קטגוריה
  }
  return { ids, needsReview: needsReview || ids.length === 0 };
}

export function topicFromSeed(e: SeedEntry, aux: SeedAux, now: number): Topic {
  const policy = POLICY_MAP[e.mappingStatus] ?? 'needs_review';
  const sys = mapSystems(e.proposedSystems, aux);
  const ageMax = aux.overrides.ageMax?.[e.seedId] ?? null;
  const coverage: Coverage = ageMax !== null
    ? { level: 'partial', reason: 'ייבוא ראשוני: מקודד רק טווח הגיל. יתר התנאים מופיעים בניסוח המקור וטרם קודדו.' }
    : { level: 'none', reason: 'ייבוא ראשוני מהמקורות: טרם קודדו כללים למקרה.' };
  return {
    id: topicIdFor(e.seedId), seedIds: [e.seedId], he: e.he, en: e.en,
    aliases: aux.aliases[e.seedId] ?? [],
    kind: 'unclassified', kindSuggestion: aux.overrides.kindSuggestion?.[e.seedId],
    systems: sys.ids, systemsRaw: e.proposedSystems, systemsNeedReview: sys.needsReview,
    tags: [], suggestedTags: [],
    policy, publish: 'published',
    ageMin: null, ageMax, difficulty: 0, notes: [],
    sourceCondition: e.sourceCondition, reviewNote: e.reviewNote, sourcePages: e.sourcePages, mappingStatusRaw: e.mappingStatus,
    familyId: aux.overrides.family?.[e.seedId] ?? `fam-${e.seedId}`,
    relations: aux.overrides.relations?.[e.seedId] ?? [],
    rules: { questions: [], rules: [] },
    coverage, generalThreshold: policy !== 'not_suitable',
    addedYear: null, sourceMapped: true,
    version: 1, updatedAt: now, updatedBy: 'seed-import',
  };
}

function changedFields(a: SeedEntry, b: SeedEntry): string[] {
  return (['he', 'en', 'proposedSystems', 'mappingStatus', 'sourceCondition', 'reviewNote', 'sourcePages'] as const)
    .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * תכנון ייבוא חוזר־בטוח לפי seedId.
 * - רשומה חדשה: נוצר נושא.
 * - רשומה זהה: דילוג.
 * - רשומה ששונתה במקור: נשמר עותק מקור חדש ונוצרת הצעת עדכון לתור המנהל. הנושא עצמו אינו נדרס.
 * - נושא שמנהל מיזג או פיצל: הקשר רב־לרב ב-topicIds ברשומת המקור, ואינו נוצר מחדש.
 */
export function planSeedImport(
  seed: SeedFile, existing: Map<string, SeedRecord>, aux: SeedAux, now: number, existingTopicIds: Set<string> = new Set(),
): ImportPlan {
  const plan: ImportPlan = { createTopics: [], upsertSeedRecords: [], suggestions: [], skipped: [] };
  for (const e of seed.entries) {
    const hash = hashEntry(e);
    const rec = existing.get(e.seedId);
    if (!rec) {
      const tid = topicIdFor(e.seedId);
      if (!existingTopicIds.has(tid)) plan.createTopics.push(topicFromSeed(e, aux, now));
      plan.upsertSeedRecords.push({ seedId: e.seedId, raw: e, hash, topicIds: [tid], importedAt: now, schemaVersion: seed.schemaVersion });
    } else if (rec.hash === hash) {
      plan.skipped.push(e.seedId);
    } else {
      plan.upsertSeedRecords.push({ ...rec, raw: e, hash, importedAt: now, schemaVersion: seed.schemaVersion });
      plan.suggestions.push({
        id: `seedupd-${e.seedId}-${hash}`, type: 'seed_update', seedId: e.seedId, topicIds: rec.topicIds,
        changedFields: changedFields(rec.raw, e), createdAt: now, state: 'open',
      });
    }
  }
  return plan;
}
