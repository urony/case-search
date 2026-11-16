import { editDistance, normalize, tokens } from './normalize';
import type { Difficulty, Policy, Topic } from './types';

export interface SearchFilters {
  system?: string;
  tag?: string;
  policy?: Policy | '';
  age?: number | null;
  difficulty?: Difficulty | '';
  hasSources?: boolean;
  newInYear?: string;
}

export interface SearchHit {
  topic: Topic;
  score: number;
  match: 'exact' | 'prefix' | 'partial' | 'approx';
  via?: string; // השם החלופי שהתאים
}

interface IndexedTopic { topic: Topic; names: { raw: string; norm: string; words: string[]; isAlias: boolean }[]; hay: string }

export function buildIndex(topics: Topic[]): IndexedTopic[] {
  return topics.map(topic => {
    const entries: { raw: string; isAlias: boolean }[] = [
      { raw: topic.he, isAlias: false }, { raw: topic.en, isAlias: false },
      ...topic.aliases.map(raw => ({ raw, isAlias: true })),
    ].filter(e => e.raw);
    const names = entries.map(e => {
      const norm = normalize(e.raw);
      return { raw: e.raw, norm, words: norm.split(' ').filter(Boolean), isAlias: e.isAlias };
    });
    return { topic, names, hay: names.map(n => n.norm).join(' | ') };
  });
}

function passesFilters(t: Topic, f: SearchFilters, sourceCounts: Record<string, number>): boolean {
  if (f.system && !t.systems.includes(f.system)) return false;
  if (f.tag && !t.tags.includes(f.tag)) return false;
  if (f.policy && t.policy !== f.policy) return false;
  if (f.difficulty !== undefined && f.difficulty !== '' && t.difficulty !== f.difficulty) return false;
  if (f.hasSources && !(sourceCounts[t.id] > 0)) return false;
  if (f.newInYear && t.addedYear !== f.newInYear) return false;
  if (f.age !== undefined && f.age !== null) {
    if (t.ageMin !== null && f.age < t.ageMin) return false;
    if (t.ageMax !== null && f.age > t.ageMax) return false;
  }
  return true;
}

export function searchTopics(index: IndexedTopic[], query: string, filters: SearchFilters = {}, sourceCounts: Record<string, number> = {}): SearchHit[] {
  const visible = index.filter(i => i.topic.publish === 'published' && passesFilters(i.topic, filters, sourceCounts));
  const qn = normalize(query);
  if (!qn) return visible.map(i => ({ topic: i.topic, score: 0, match: 'partial' as const })).sort((a, b) => a.topic.he.localeCompare(b.topic.he, 'he'));
  const qTokens = tokens(query);
  const hits: SearchHit[] = [];
  for (const it of visible) {
    let best: SearchHit | null = null;
    const consider = (h: SearchHit) => { if (!best || h.score > best.score) best = h; };
    for (const n of it.names) {
      if (!n.norm) continue;
      if (n.norm === qn) consider({ topic: it.topic, score: 100, match: 'exact', via: n.isAlias ? n.raw : undefined });
      else if (n.norm.startsWith(qn)) consider({ topic: it.topic, score: 80, match: 'prefix', via: n.isAlias ? n.raw : undefined });
      else if (n.norm.includes(qn)) consider({ topic: it.topic, score: 60, match: 'partial', via: n.isAlias ? n.raw : undefined });
      else if (qTokens.length > 1 && qTokens.every(t => n.norm.includes(t))) consider({ topic: it.topic, score: 55, match: 'partial', via: n.isAlias ? n.raw : undefined });
    }
    if (!best) {
      // התאמה משוערת (שגיאות כתיב): מוצגת בנפרד לבחירה, לא מחליפה בשקט
      for (const n of it.names) {
        for (const w of n.words) for (const t of qTokens) {
          if (t.length < 4 || w.length < 4) continue;
          const maxD = t.length >= 8 ? 2 : 1;
          if (editDistance(t, w, maxD) <= maxD) consider({ topic: it.topic, score: 30, match: 'approx', via: n.isAlias ? n.raw : undefined });
        }
      }
    }
    // חיפוש גם בשם מערכת/תגית אינו נחשב התאמת שם: נשאר לסינון
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score || a.topic.he.localeCompare(b.topic.he, 'he'));
}
