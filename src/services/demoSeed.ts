import { planSeedImport } from '../domain/seedImport';
import { academicYear, currentStartYear } from '../domain/years';
import { DEFAULT_GENERAL_RULES } from '../engine/general';
import type { Group, Membership, Profile, RecruitmentSource, RoleDoc, School, SchoolYearHistory, Topic } from '../domain/types';
import type { DemoAccount } from './auth';
import { buildCatalogOps } from './catalog';
import { DEFAULT_TAGS, defaultSettings, defaultYears, SEED, SEED_AUX } from './bundled';
import type { Store } from './store';

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_SCHOOL_ID = '999001';

/** חשבונות מלאכותיים להדגמה בלבד (דומיין demo.test). אין להם קשר למשתמשים אמיתיים. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { uid: 'demo-admin', email: 'admin@demo.test', password: DEMO_PASSWORD, displayName: 'מנהל הדגמה', emailVerified: true },
  { uid: 'demo-coord', email: 'coordinator@demo.test', password: DEMO_PASSWORD, displayName: 'רכז הדגמה', emailVerified: true },
  { uid: 'demo-teacher', email: 'teacher@demo.test', password: DEMO_PASSWORD, displayName: 'מורה הדגמה', emailVerified: true },
  { uid: 'demo-teacher2', email: 'teacher2@demo.test', password: DEMO_PASSWORD, displayName: 'מורה הדגמה ב׳', emailVerified: true },
];

/** נושא מלאכותי בלבד, עם כיסוי מלא, כדי להדגים תוצאה חיובית. אינו מחלה אמיתית ואינו קיים בנתוני הייצור. */
export function demoTopic(now: number): Topic {
  return {
    id: 't-DEMO1', seedIds: [], he: 'נושא הדגמה מלאכותי (לא מחלה אמיתית)', en: 'Artificial demo topic', aliases: ['דמו', 'demo'],
    kind: 'condition', systems: ['multisystem'], systemsRaw: [], systemsNeedReview: false, tags: [], suggestedTags: [],
    policy: 'conditional', publish: 'published', ageMin: null, ageMax: 18, difficulty: 2,
    notes: [
      { id: 'n1', type: 'attention', title: 'נתוני הדגמה', text: 'נושא מלאכותי בלבד, להדגמת תוצאות המערכת. אין לו קשר לרפואה או להנחיות אמיתיות.', severity: 'warning', active: true, showInResults: true },
    ],
    sourceCondition: 'דוגמה מלאכותית: עד גיל 18 כולל, ובטיפול קבוע.', reviewNote: 'דוגמה מלאכותית בלבד.', sourcePages: '', mappingStatusRaw: 'הדגמה',
    familyId: 'fam-demo1', relations: [],
    rules: {
      questions: [{ id: 'on_treatment', label: 'האם במצב הדגמה יש טיפול קבוע?', type: 'yesno' }],
      rules: [{ id: 'demo-tx', title: 'טיפול קבוע (דוגמה)', teacherText: 'נדרש טיפול קבוע', severity: 'mandatory', status: 'published',
        cond: { q: 'on_treatment', cmp: 'eq', value: 'yes' }, failText: 'אין טיפול קבוע (דוגמה מלאכותית).', missingText: 'לא נמסר אם יש טיפול קבוע.' }],
    },
    coverage: { level: 'full', reason: 'נושא הדגמה מלאכותי', approvedBy: 'מנהל הדגמה', approvedAt: now },
    generalThreshold: false, addedYear: academicYear(currentStartYear(new Date(now))).id, sourceMapped: false,
    version: 1, updatedAt: now, updatedBy: 'demo-admin',
  };
}

/** מזין את המאגר (הדגמה או שירות חדש) מנתוני המקור. withDemoData=false מייבא רק את המיפוי, ללא משתמשים או מוסדות. */
export async function seedStore(store: Store, now: number, withDemoData: boolean) {
  const plan = planSeedImport(SEED, new Map(), SEED_AUX, now);
  const ops: any[] = [];
  const topics = [...plan.createTopics];
  if (withDemoData) topics.push(demoTopic(now));
  for (const t of topics) { ops.push({ op: 'set', path: `topics/${t.id}`, data: t }); ops.push({ op: 'set', path: `topicVersions/${t.id}__v1`, data: { ...t, baseId: t.id } }); }
  for (const r of plan.upsertSeedRecords) ops.push({ op: 'set', path: `seedEntries/${r.seedId}`, data: r });
  const settings = defaultSettings(new Date(now));
  ops.push({ op: 'set', path: 'config/settings', data: settings });
  ops.push({ op: 'set', path: 'config/general', data: { rules: DEFAULT_GENERAL_RULES, updatedAt: now, updatedBy: 'seed' } });
  ops.push({ op: 'set', path: 'config/vocab', data: { systems: SEED_AUX.systems, tags: DEFAULT_TAGS } });
  ops.push({ op: 'set', path: 'config/years', data: { years: defaultYears(new Date(now)) } });
  if (withDemoData) {
    const year = academicYear(currentStartYear(new Date(now))), prev = academicYear(currentStartYear(new Date(now)) - 1);
    ops.push({ op: 'set', path: 'config/contact', data: { email: 'responsible@demo.test', name: 'אחראי הדגמה' } });
    const school: School = { id: DEMO_SCHOOL_ID, name: 'בית ספר הדגמה (מלאכותי, לא מוסד אמיתי)', city: 'עיר הדגמה', active: true };
    ops.push({ op: 'set', path: `schools/${school.id}`, data: school });
    for (const a of DEMO_ACCOUNTS) {
      const p: Profile = { uid: a.uid, displayName: a.displayName, email: a.email, emailVerified: true, createdAt: now };
      ops.push({ op: 'set', path: `profiles/${a.uid}`, data: p });
      const m: Membership = { id: `${a.uid}_${school.id}`, uid: a.uid, schoolId: school.id, startedAt: now, endedAt: null };
      if (a.uid !== 'demo-admin') ops.push({ op: 'set', path: `memberships/${m.id}`, data: m });
    }
    const role = (r: RoleDoc['role'], schoolId?: string): RoleDoc => ({ role: r, ...(schoolId ? { schoolId } : {}), grantedBy: 'seed', grantedAt: now });
    ops.push({ op: 'set', path: 'roles/demo-admin', data: role('admin') });
    ops.push({ op: 'set', path: 'roles/demo-coord', data: role('coordinator', school.id) });
    const src = (id: string, topicId: string, title: string, kind: RecruitmentSource['kind'], text: string): RecruitmentSource =>
      ({ id, topicId, title, kind, text, url: '', phone: '', region: 'ארצי', population: '', createdBy: 'demo-teacher', createdAt: now, visible: true });
    ops.push({ op: 'set', path: 'sources/demo-src-1', data: src('demo-src-1', 't-DEMO1', 'עמותת הדגמה (מלאכותית)', 'association', 'מקור לדוגמה בלבד. אינו קיים במציאות.') });
    ops.push({ op: 'set', path: 'sources/demo-src-2', data: src('demo-src-2', 't-S054', 'קבוצת הדגמה לנושא COPD (מלאכותית)', 'facebook', 'מקור לדוגמה בלבד, להדגמת הצגת מקורות בכרטיס.') });
    const hist = (y: string, items: SchoolYearHistory['items']): SchoolYearHistory => ({ id: `${DEMO_SCHOOL_ID}_${y}`, schoolId: DEMO_SCHOOL_ID, yearId: y, items, updatedAt: now });
    ops.push({ op: 'set', path: `schoolHistory/${DEMO_SCHOOL_ID}_${prev.id}`, data: hist(prev.id, [
      { groupId: 'demo-h1', topicId: 't-S055', familyId: 'fam-copd', topicHe: 'אמפיזמה', state: 'done' },
      { groupId: 'demo-h2', topicId: 't-S034', familyId: 'fam-S034', topicHe: 'צליאק', state: 'approved_not_done' },
    ]) });
    const g: Group = { id: 'demo-group-1', ownerUid: 'demo-teacher', schoolId: school.id, yearId: year.id, topicId: 't-DEMO1', studentCount: 2, students: [{ label: 'כינוי א׳' }, { label: 'כינוי ב׳' }], status: 'self_check', casesDeclared: 1, ruleVersionAtCheck: 1, createdAt: now, updatedAt: now };
    ops.push({ op: 'set', path: `groups/${g.id}`, data: g });
  }
  await store.batch(ops);
  const built = await buildCatalogOps(store, now);
  await store.batch(built.ops);
}
