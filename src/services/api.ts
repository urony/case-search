import { validateRuleSet } from '../engine/validate';
import { DEFAULT_GENERAL_RULES } from '../engine/general';
import type { RuleSet } from '../engine/types';
import { checkSourceInput, dueAtFor, looksLikePersonalData, SourceInput } from '../domain/helpers';
import { normEmail, EMAIL_RE, previewSchoolImport, previewTeacherImport } from '../domain/csv';
import { planSeedImport, SeedRecord } from '../domain/seedImport';
import type {
  AcademicYear, AllowedTeacher, AuditEvent, Catalog, CatalogMeta, Group, NewItem, PublicSource, GroupStatus, PolicyQuestion,
  Profile, RecruitmentSource, RequestDoc, RequestKind, Role, RoleDoc, School, SchoolYearHistory, Settings, SourceReport, SystemDef, TagDef, Topic,
} from '../domain/types';
import type { AuthService, AuthUser } from './auth';
import { buildBundledCatalog, DEFAULT_TAGS, defaultSettings, defaultYears, SEED, SEED_AUX } from './bundled';
import { BatchOp, ConflictError, PermissionError, Store } from './store';
import { buildCatalogOps, diffAgainstLive, PublishDiff, readSnapshotDocs } from './catalog';

export type Mode = 'service' | 'demo' | 'bundled';

/** עותק מקומי של העותק הציבורי בדפדפן (מידע ציבורי בלבד). חוסך קריאות מסד: ביקור חוזר עולה קריאה אחת או אפס. */
export interface SnapshotCache { read(): { checkedAt: number; catalog: Catalog } | null; write(v: { checkedAt: number; catalog: Catalog }): void; clear(): void }
/** בתוך חלון זה לא פונים כלל למסד: עד חמש דקות עיכוב בהצגת עדכון חדש לאורח (המנהל רואה את שינויו מיד) */
export const CATALOG_FRESH_MS = 5 * 60_000;

/** approved: מאומת ו(ברשימת המורים המאושרים או בעל תפקיד). רק מאושר יכול לשמור או להזין תוכן. schoolIds: המוסדות שאושרו לו. */
export interface Ctx { user: AuthUser | null; role: Role | null; roleDoc: RoleDoc | null; verified: boolean; approved: boolean; schoolIds: string[] }

/** מכסות יומיות להוספה (מונעות הצפה בלי לבטל פרסום מיידי). נאכפות גם בכללי השירות דרך מבנה המזהה. */
export const DAILY_SOURCE_CAP = 5;
export const DAILY_REQUEST_CAP = 10;
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

/** תווית תלמיד: שם פרטי או כינוי בלבד. דוחה מספרי זהות, מיילים וטלפונים (סעיף 16.2). */
export function checkStudentLabel(label: string): string | null {
  const s = label.trim();
  if (s.length > 30) return 'שם או כינוי: עד 30 תווים.';
  if (/\d{5,}/.test(s) || /@/.test(s)) return 'יש להזין שם פרטי או כינוי בלבד, ללא מספרים או כתובות.';
  return null;
}

export class Api {
  constructor(readonly store: Store, readonly auth: AuthService, readonly mode: Mode, private clock: () => number = Date.now) {}
  now() { return this.clock(); }

  // ───────── הקשר והרשאות (בצד הלקוח: הגנה נוספת בלבד; האכיפה האמיתית ב-firestore.rules) ─────────
  // מטמון קצר (30 שניות, שעון אמיתי) להקשר המשתמש: חוסך 2 קריאות מסד בכל פעולה. כללי השירות ממשיכים לבדוק בכל בקשה,
  // ולכן ביטול גישה חל מיד בשירות גם אם הממשק עדיין מציג אחרת עד 30 שניות. מנוקה בכל שינוי הרשאות דרך אותו מופע.
  private ctxCache: { key: string; at: number; v: Ctx } | null = null;
  clearCtxCache() { this.ctxCache = null; }
  async ctx(): Promise<Ctx> {
    const u = this.auth.current();
    const key = u ? `${u.uid}|${u.email}|${u.emailVerified}` : 'guest';
    if (this.ctxCache && this.ctxCache.key === key && Date.now() - this.ctxCache.at < 30_000) return this.ctxCache.v;
    const v = await this.ctxFresh();
    this.ctxCache = { key, at: Date.now(), v };
    return v;
  }
  private async ctxFresh(): Promise<Ctx> {
    const user = this.auth.current();
    if (!user) return { user: null, role: null, roleDoc: null, verified: false, approved: false, schoolIds: [] };
    let roleDoc: RoleDoc | null = null;
    let allow: AllowedTeacher | null = null;
    try { roleDoc = await this.store.get<RoleDoc>(`roles/${user.uid}`); } catch { /* אין הרשאה/שירות */ }
    // אישור מראש לפי כתובת מייל מאומתת: ההקלדה בלבד אינה מספיקה, נדרש גם אימות שליטה בכתובת (token.email_verified)
    if (user.emailVerified && !roleDoc) { try { allow = await this.store.get<AllowedTeacher>(`allowedTeachers/${normEmail(user.email)}`); } catch { /* ללא הרשאה */ } }
    const allowed = !!allow && allow.active === true;
    const approved = user.emailVerified && (allowed || !!roleDoc);
    const schoolIds = [...new Set([...(allowed ? allow!.schoolIds : []), ...(roleDoc?.schoolId ? [roleDoc.schoolId] : [])])];
    return { user, role: roleDoc?.role ?? (approved ? 'teacher' : null), roleDoc, verified: user.emailVerified, approved, schoolIds };
  }
  private async need(min: 'verified' | 'approved' | 'coordinator' | 'admin'): Promise<Ctx> {
    const c = await this.ctx();
    if (!c.user) throw new PermissionError('יש להתחבר.');
    if (!c.verified) throw new PermissionError('יש לאמת את כתובת המייל לפני ביצוע הפעולה.');
    if (min !== 'verified' && !c.approved) throw new PermissionError('כתובת המייל שלך אינה ברשימת המורים שאושרו על ידי הפיקוח. יש לפנות לפיקוח.');
    if (min === 'admin' && c.role !== 'admin') throw new PermissionError();
    if (min === 'coordinator' && c.role !== 'admin' && c.role !== 'coordinator') throw new PermissionError();
    return c;
  }
  private audit(action: string, ref: string, actor: string, scope = 'admin'): BatchOp {
    // ביומן אין נתוני תלמידים או מטופלים: פעולה והיקף בלבד
    const id = `a-${this.now()}-${uuid().slice(0, 6)}`;
    const ev: Omit<AuditEvent, 'id'> = { at: this.now(), actor, action, ref, scope };
    return { op: 'set', path: `audit/${id}`, data: ev };
  }

  // ───────── ציבורי ─────────
  /** מוגדר בהפעלה בשירות אמיתי (localStorage). בבדיקות: מימוש בזיכרון. */
  snapshotCache: SnapshotCache | null = null;
  async loadCatalog(): Promise<Catalog> {
    if (this.mode === 'bundled') return buildBundledCatalog(this.now());
    const cache = this.snapshotCache;
    const cached = cache?.read() ?? null;
    const t = this.now();
    if (cached && t >= cached.checkedAt && t - cached.checkedAt < CATALOG_FRESH_MS) return cached.catalog;
    try {
      const meta = await this.store.get<CatalogMeta>('public/catalogMeta');
      if (!meta) {
        if (this.mode === 'service') return { ...buildBundledCatalog(this.now()), origin: 'bundled' };
        throw new Error('catalog not published');
      }
      // העותק המקומי עדכני: קריאה אחת בלבד
      if (cached && cached.catalog.generatedAt === meta.generatedAt) { cache!.write({ checkedAt: t, catalog: cached.catalog }); return cached.catalog; }
      const { topics, sources } = await readSnapshotDocs(this.store, meta);
      // עותק ישן (לפני הוספת ההגדרות למסמך הראשי): משלימים מההגדרות
      const [general, vocab, settings, years] = meta.general ? [null, null, null, null] : await Promise.all([
        this.store.get<{ rules: RuleSet }>('config/general'), this.store.get<{ systems: SystemDef[]; tags: TagDef[] }>('config/vocab'),
        this.store.get<Settings>('config/settings'), this.store.get<{ years: AcademicYear[] }>('config/years'),
      ]);
      const bySource: Record<string, PublicSource[]> = {};
      for (const x of sources) (bySource[x.topicId] ??= []).push(x);
      const catalog: Catalog = {
        topics, generalRules: meta.general ?? general?.rules ?? DEFAULT_GENERAL_RULES,
        systems: meta.vocab?.systems ?? vocab?.systems ?? SEED_AUX.systems, tags: meta.vocab?.tags ?? vocab?.tags ?? DEFAULT_TAGS,
        settings: { ...defaultSettings(new Date(this.now())), ...(meta.settings ?? settings ?? {}) },
        years: meta.years ?? years?.years ?? defaultYears(new Date(this.now())),
        generatedAt: meta.generatedAt, sourceCounts: meta.sourceCounts ?? {}, sources: bySource, newItems: meta.newItems ?? [],
        origin: this.mode === 'demo' ? 'demo' : 'service',
      };
      cache?.write({ checkedAt: t, catalog });
      return catalog;
    } catch (e) {
      // כשל בקריאה: עותק שמור מוצג כשמור (stale) ולא כעדכני
      if (cached) return { ...cached.catalog, stale: true };
      if (this.mode === 'service') return { ...buildBundledCatalog(this.now()), origin: 'bundled' };
      throw e;
    }
  }
  /** היסטוריית מוסד: רק למורה מאושר המשויך למוסד, לרכז של המוסד או למנהל. אורח ומורה אחר אינם רואים (נאכף גם בכללי השירות). */
  async getSchoolHistory(schoolId: string, yearId: string): Promise<SchoolYearHistory | null> {
    const c = await this.need('approved');
    if (c.role !== 'admin' && !c.schoolIds.includes(schoolId)) throw new PermissionError('ההיסטוריה זמינה רק למורים המשויכים למוסד.');
    return this.store.get<SchoolYearHistory>(`schoolHistory/${schoolId}_${yearId}`);
  }
  async getSchool(code: string): Promise<School | null> { await this.need('approved'); return this.store.get<School>(`schools/${code.trim()}`); }
  async getContact(): Promise<{ email: string; name: string } | null> {
    const c = await this.ctx();
    if (!c.user || !c.approved) return null;
    const d = await this.store.get<{ email: string; name: string }>('config/contact');
    return d ?? null;
  }

  // ───────── חשבון ─────────
  async ensureProfile(): Promise<Profile | null> {
    const c = await this.ctx();
    if (!c.user) return null;
    const existing = await this.store.get<Profile>(`profiles/${c.user.uid}`);
    const p: Profile = { uid: c.user.uid, displayName: c.user.displayName || existing?.displayName || '', email: c.user.email, emailVerified: c.user.emailVerified, createdAt: existing?.createdAt ?? this.now() };
    if (!existing || existing.emailVerified !== p.emailVerified || existing.displayName !== p.displayName) await this.store.set(`profiles/${c.user.uid}`, p);
    return p;
  }
  /** המוסדות שהפיקוח אישר למורה (לפי הרשימה המאושרת), ולרכז: מוסדו. אין הצטרפות עצמית בקוד. */
  async mySchools(): Promise<{ id: string; schoolId: string; school: School | null }[]> {
    const c = await this.ctx();
    if (!c.user || !c.approved) return [];
    const out = [];
    for (const id of c.schoolIds) out.push({ id, schoolId: id, school: await this.store.get<School>(`schools/${id}`).catch(() => null) });
    return out;
  }

  // ───────── קבוצות ─────────
  async listMyGroups(): Promise<Group[]> {
    const c = await this.need('approved');
    return (await this.store.list<Group>('groups', [['ownerUid', '==', c.user!.uid]])).sort((a, b) => b.createdAt - a.createdAt);
  }
  async listSchoolGroups(schoolId: string): Promise<Group[]> {
    const c = await this.need('coordinator');
    if (c.role === 'coordinator' && c.roleDoc?.schoolId !== schoolId) throw new PermissionError();
    return this.store.list<Group>('groups', [['schoolId', '==', schoolId]]);
  }
  async createGroup(input: { schoolId: string; yearId: string; studentCount: number; students?: string[]; topicId?: string | null; clientId?: string }): Promise<Group> {
    const c = await this.need('approved');
    if (![1, 2, 3].includes(input.studentCount)) throw new Error('מספר התלמידים חייב להיות 1, 2 או 3.');
    const labels = (input.students ?? []).map(s => s.trim()).filter(Boolean);
    if (labels.length > input.studentCount) throw new Error('מספר השמות גדול ממספר התלמידים.');
    for (const l of labels) { const e = checkStudentLabel(l); if (e) throw new Error(e); }
    if (!c.schoolIds.includes(input.schoolId)) throw new PermissionError('אין אישור ליצור קבוצה במוסד זה. המוסד נקבע על ידי הפיקוח.');
    const year = await this.getYear(input.yearId);
    if (year?.closed) throw new Error('המחזור נסגר. לא ניתן ליצור קבוצות חדשות.');
    const id = input.clientId ?? uuid();
    const existing = await this.store.get<Group>(`groups/${id}`);
    if (existing) return existing; // חוזר־בטוח: לחיצה כפולה אינה יוצרת כפילות
    const g: Group = {
      id, ownerUid: c.user!.uid, schoolId: input.schoolId, yearId: input.yearId, topicId: input.topicId ?? null,
      studentCount: input.studentCount as 1 | 2 | 3, students: labels.map(label => ({ label })),
      status: 'draft', casesDeclared: 0, ruleVersionAtCheck: null, createdAt: this.now(), updatedAt: this.now(),
    };
    await this.store.set(`groups/${id}`, g);
    if (g.topicId) await this.syncHistory(g, 'declared');
    return g;
  }
  private async ownGroup(id: string): Promise<{ g: Group; c: Ctx }> {
    const c = await this.need('approved');
    const g = await this.store.get<Group>(`groups/${id}`);
    if (!g) throw new Error('הקבוצה לא נמצאה.');
    const isCoord = c.role === 'coordinator' && c.roleDoc?.schoolId === g.schoolId;
    if (g.ownerUid !== c.user!.uid && !isCoord && c.role !== 'admin') throw new PermissionError();
    return { g, c };
  }
  async updateStudents(groupId: string, studentCount: number, students: string[]): Promise<Group> {
    const { g } = await this.ownGroup(groupId);
    if (![1, 2, 3].includes(studentCount)) throw new Error('מספר התלמידים חייב להיות 1, 2 או 3.');
    const labels = students.map(s => s.trim()).filter(Boolean);
    if (labels.length > studentCount) throw new Error('מספר השמות גדול ממספר התלמידים.');
    for (const l of labels) { const e = checkStudentLabel(l); if (e) throw new Error(e); }
    // שינוי תלמידים אינו פותח בירור מקצועי מחדש; רק מתאים את מספר המקרים הנדרש
    const next: Group = { ...g, studentCount: studentCount as 1 | 2 | 3, students: labels.map(label => ({ label })), casesDeclared: Math.min(g.casesDeclared, studentCount), updatedAt: this.now() };
    if (next.status === 'case_check_done' && next.casesDeclared < next.studentCount) next.status = 'self_check';
    await this.store.set(`groups/${groupId}`, next);
    return next;
  }
  /** החלפת נושא: שומרת פרטי תלמידים ופותחת את בדיקת הנושא מחדש (T21). */
  async setGroupTopic(groupId: string, topic: Pick<Topic, 'id' | 'familyId' | 'he' | 'version'>): Promise<Group> {
    const { g } = await this.ownGroup(groupId);
    if (g.status === 'cancelled' || g.status === 'done') throw new Error('לא ניתן להחליף נושא בקבוצה שהסתיימה או בוטלה.');
    const prevTopic = g.topicId;
    const next: Group = { ...g, topicId: topic.id, status: 'self_check', casesDeclared: 0, ruleVersionAtCheck: topic.version, updatedAt: this.now() };
    await this.store.set(`groups/${groupId}`, next);
    await this.syncHistory(next, 'declared', topic, prevTopic !== topic.id);
    return next;
  }
  /** הצהרה קבוצתית בלבד: כמה מקרים נבדקו לפי המורה. ללא מזהי מטופל וללא תוצאות ברמת אדם (T15). */
  async declareCases(groupId: string, n: number): Promise<Group> {
    const { g } = await this.ownGroup(groupId);
    if (!Number.isInteger(n) || n < 0 || n > g.studentCount) throw new Error(`מספר הבדיקות חייב להיות בין 0 ל־${g.studentCount}.`);
    const status: GroupStatus = n === g.studentCount ? 'case_check_done' : (g.status === 'case_check_done' ? 'self_check' : g.status);
    const next = { ...g, casesDeclared: n, status, updatedAt: this.now() };
    await this.store.set(`groups/${groupId}`, next);
    return next;
  }
  async setGroupStatus(groupId: string, status: GroupStatus): Promise<Group> {
    const { g } = await this.ownGroup(groupId);
    const next = { ...g, status, updatedAt: this.now() };
    await this.store.set(`groups/${groupId}`, next);
    if (status === 'cancelled') await this.syncHistory(next, 'cancelled');
    return next;
  }
  private async syncHistory(g: Group, state: 'declared' | 'cancelled', topic?: Pick<Topic, 'id' | 'familyId' | 'he'>, _topicChanged = false) {
    if (!g.topicId) return;
    let t = topic;
    if (!t) { const full = await this.store.get<Topic>(`topics/${g.topicId}`).catch(() => null); if (full) t = full; }
    if (!t) { const cat = await this.loadCatalog().catch(() => null); t = cat?.topics.find(x => x.id === g.topicId); }
    if (!t) return;
    const id = `${g.schoolId}_${g.yearId}`;
    const h = (await this.store.get<SchoolYearHistory>(`schoolHistory/${id}`)) ?? { id, schoolId: g.schoolId, yearId: g.yearId, items: [], updatedAt: 0 };
    const items = h.items.filter(i => i.groupId !== g.id);
    items.push({ groupId: g.id, topicId: t.id, familyId: t.familyId, topicHe: t.he, state });
    await this.store.set(`schoolHistory/${id}`, { schoolId: g.schoolId, yearId: g.yearId, items, updatedAt: this.now() });
  }

  // ───────── מכסה יומית ─────────
  /**
   * מזהה מסמך יומי למשתמש: `uid_YYYYMMDD_n`, n עד המכסה. כללי השירות אוכפים את אותו מבנה, ולכן המכסה אמיתית ולא רק בממשק.
   * חוזר־בטוח: clientId זהה מחזיר את המסמך שכבר נוצר.
   */
  private async dailySlot<T extends { clientId?: string }>(coll: string, uid: string, cap: number, clientId: string | undefined): Promise<{ id: string; existing: T | null }> {
    const day = dayKey(this.now());
    for (let n = 1; n <= cap; n++) {
      const id = `${uid}_${day}_${n}`;
      const cur = await this.store.get<T>(`${coll}/${id}`);
      if (!cur) return { id, existing: null };
      if (clientId && cur.clientId === clientId) return { id, existing: cur };
    }
    throw new Error(`הגעתם למכסה היומית (${cap}). אפשר להמשיך מחר.`);
  }

  // ───────── מקורות איתור (סעיף 13) ─────────
  /** פרסום מיידי; המקור מסומן "טרם נבדק" עד שמנהל מאשר שראה אותו. מכסה יומית למשתמש. חוזר־בטוח לפי clientId. */
  async addSource(input: SourceInput & { clientId?: string }): Promise<RecruitmentSource> {
    const c = await this.need('approved');
    const chk = checkSourceInput(input);
    if (!chk.ok || !chk.clean) throw new Error(chk.errors.join(' '));
    const { id, existing } = await this.dailySlot<RecruitmentSource>('sources', c.user!.uid, DAILY_SOURCE_CAP, input.clientId);
    if (existing) return existing;
    const s: RecruitmentSource = stripUndefined({ id, ...chk.clean, createdBy: c.user!.uid, createdAt: this.now(), visible: true, reviewed: false, clientId: input.clientId });
    await this.store.set(`sources/${id}`, s);
    return s;
  }
  /** מקורות לנושא אחד בלבד (קריאות רק למה שמוצג). ללא נושא: כולם (הדגמה ובדיקות). */
  async listSources(topicId?: string): Promise<RecruitmentSource[]> {
    const f: [string, '==', unknown][] = [['visible', '==', true]];
    if (topicId) f.push(['topicId', '==', topicId]);
    return this.store.list<RecruitmentSource>('sources', f);
  }
  /** דיווח אחד לכל משתמש ומקור: אין הצפה של אותו דיווח. */
  async reportSource(sourceId: string, reason: string) {
    const c = await this.need('approved');
    const r: SourceReport = { id: `${c.user!.uid}_${sourceId}`, sourceId, reason: reason.trim().slice(0, 300), createdBy: c.user!.uid, createdAt: this.now(), handled: false };
    if (!r.reason) throw new Error('נדרש תיאור קצר של הבעיה.');
    if (await this.store.get(`sourceReports/${r.id}`)) return;
    await this.store.set(`sourceReports/${r.id}`, r);
  }
  async adminListSourceReports(onlyOpen = true): Promise<SourceReport[]> {
    await this.need('admin');
    return (await this.store.list<SourceReport>('sourceReports', onlyOpen ? [['handled', '==', false]] : [])).sort((a, b) => b.createdAt - a.createdAt);
  }
  async adminHandleReport(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sourceReports/${id}`, data: { handled: true, handledBy: c.user!.uid, handledAt: this.now() } }, this.audit('handle_report', id, c.user!.uid)]);
  }
  /** סימון "נבדק". מקור שנבדק ונשאר גלוי נשאר גלוי. */
  async adminMarkSourcesReviewed(ids: string[]) {
    const c = await this.need('admin');
    if (ids.length === 0) return;
    await this.store.batch([...ids.map(id => ({ op: 'update', path: `sources/${id}`, data: { reviewed: true, reviewedBy: c.user!.uid, reviewedAt: this.now() } }) as BatchOp), this.audit('review_sources', `${ids.length} sources`, c.user!.uid)]);
  }
  async adminEditSource(id: string, patch: Partial<Pick<RecruitmentSource, 'title' | 'text' | 'url' | 'phone' | 'region' | 'population' | 'kind' | 'topicId'>>) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { ...patch, editedBy: c.user!.uid, editedAt: this.now(), reviewed: true, reviewedBy: c.user!.uid, reviewedAt: this.now() } }, this.audit('edit_source', id, c.user!.uid)]);
  }
  async adminRemoveSource(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { visible: false, reviewed: true, reviewedBy: c.user!.uid, reviewedAt: this.now(), editedBy: c.user!.uid, editedAt: this.now() } }, this.audit('remove_source', id, c.user!.uid)]);
  }
  async adminRestoreSource(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { visible: true, editedBy: c.user!.uid, editedAt: this.now() } }, this.audit('restore_source', id, c.user!.uid)]);
  }
  async adminListSources(onlyUnreviewed = false): Promise<RecruitmentSource[]> {
    await this.need('admin');
    return this.store.list<RecruitmentSource>('sources', onlyUnreviewed ? [['reviewed', '==', false]] : []);
  }

  // ───────── חיווי פנימי "דורש טיפול" (ללא דוא"ל) ─────────
  /**
   * כל ספירה היא שאילתה שקוראת רק את הפריטים הממתינים (לא את כל האוסף),
   * ולכן העלות בקריאות פרופורציונלית למה שמחכה לטיפול.
   */
  async adminBadges(): Promise<{ openRequests: number; inProgress: number; unreviewedSources: number; openReports: number; openSuggestions: number; total: number }> {
    await this.need('admin');
    // ספירה בלבד (count): עלות של כקריאה אחת לכל 1,000 פריטים ממתינים, ולא קריאה לכל פריט.
    const [open, prog, src, rep, sug] = await Promise.all([
      this.store.count('requests', [['status', '==', 'open']]),
      this.store.count('requests', [['status', '==', 'in_progress']]),
      this.store.count('sources', [['reviewed', '==', false]]),
      this.store.count('sourceReports', [['handled', '==', false]]),
      this.store.count('suggestions', [['state', '==', 'open']]),
    ]);
    return { openRequests: open, inProgress: prog, unreviewedSources: src, openReports: rep, openSuggestions: sug, total: open + src + rep + sug };
  }

  // ───────── בקשות (סעיף 15) ─────────
  async createRequest(input: {
    kind: RequestKind; groupId?: string; topicId?: string; proposedHe?: string; proposedEn?: string; proposedKind?: string; proposedSystem?: string;
    description: string; rationale?: string; clientId?: string;
  }): Promise<RequestDoc> {
    const c = await this.need('approved');
    const { id, existing } = await this.dailySlot<RequestDoc>('requests', c.user!.uid, DAILY_REQUEST_CAP, input.clientId);
    if (existing) return existing; // חוזר־בטוח: אין שתי בקשות מלחיצה כפולה (T24)
    if (input.kind === 'new_topic' && !(input.proposedHe ?? '').trim() && !(input.proposedEn ?? '').trim()) throw new Error('נדרש שם הנושא בעברית או באנגלית.');
    if (!input.description.trim()) throw new Error('נדרש תיאור כללי.');
    if (looksLikePersonalData(`${input.description} ${input.rationale ?? ''}`)) throw new Error('נראה שהטקסט כולל מספר זיהוי או כתובת מייל. הבקשה אינה מיועדת לפרטי אדם.');
    const settings = (await this.store.get<Settings>('config/settings')) ?? defaultSettings(new Date(this.now()));
    const r: RequestDoc = stripUndefined({
      id, kind: input.kind, createdBy: c.user!.uid, createdByEmail: normEmail(c.user!.email), createdByName: (c.user!.displayName || '').slice(0, 80), createdAt: this.now(), updatedAt: this.now(), status: 'open',
      groupId: input.groupId, topicId: input.topicId, proposedHe: input.proposedHe?.trim(), proposedEn: input.proposedEn?.trim(),
      proposedKind: input.proposedKind, proposedSystem: input.proposedSystem,
      description: input.description.trim().slice(0, 2000), rationale: (input.rationale ?? '').trim().slice(0, 2000),
      dueAt: dueAtFor(this.now(), settings.responseDueDays), clientId: input.clientId,
    });
    await this.store.set(`requests/${id}`, r);
    return r;
  }
  async listMyRequests(): Promise<RequestDoc[]> {
    const c = await this.need('approved');
    return (await this.store.list<RequestDoc>('requests', [['createdBy', '==', c.user!.uid]])).sort((a, b) => b.createdAt - a.createdAt);
  }
  async supplementRequest(id: string, text: string) {
    const c = await this.need('approved');
    const r = await this.store.get<RequestDoc>(`requests/${id}`);
    if (!r || r.createdBy !== c.user!.uid) throw new PermissionError();
    if (looksLikePersonalData(text)) throw new Error('נראה שהטקסט כולל מספר זיהוי או כתובת מייל.');
    await this.store.update(`requests/${id}`, { supplement: text.trim().slice(0, 2000), status: 'open', updatedAt: this.now() });
  }
  async adminListRequests(statuses?: RequestDoc['status'][]): Promise<RequestDoc[]> { await this.need('admin'); return (await this.store.list<RequestDoc>('requests', statuses ? [['status', 'in', statuses]] : [])).sort((a, b) => a.createdAt - b.createdAt); }
  async adminReply(id: string, reply: { decisionKind: NonNullable<RequestDoc['decisionKind']>; text: string; status: RequestDoc['status'] }) {
    const c = await this.need('admin');
    const r = await this.store.get<RequestDoc>(`requests/${id}`);
    if (!r) throw new Error('הבקשה לא נמצאה.');
    const at = this.now();
    await this.store.batch([
      { op: 'update', path: `requests/${id}`, data: { adminReply: reply.text.trim().slice(0, 2000), decisionKind: reply.decisionKind, status: reply.status, updatedAt: at, repliedAt: at, teacherSeenAt: 0 } },
      this.audit('reply_request', id, c.user!.uid),
    ]);
  }
  /** שינוי מצב בלי מענה, למשל "בטיפול" או "סגורה". */
  async adminSetRequestStatus(id: string, status: RequestDoc['status']) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `requests/${id}`, data: { status, updatedAt: this.now() } }, this.audit(`request_${status}`, id, c.user!.uid)]);
  }
  /** מורה: מספר הבקשות שיש בהן מענה שטרם נראה. קורא רק את הבקשות של המורה עצמו. */
  async myUnseenReplies(): Promise<number> {
    const c = await this.ctx();
    if (!c.user || !c.verified) return 0;
    return (await this.listMyRequests()).filter(r => r.repliedAt && !r.teacherSeenAt).length;
  }
  /** המורה פתח את "הבקשות שלי": המענים שנראו מסומנים (כתיבה רק לבקשות שיש בהן חדש). */
  async markMyRepliesSeen(reqs: RequestDoc[]) {
    const c = await this.need('approved');
    const at = this.now();
    for (const r of reqs) if (r.createdBy === c.user!.uid && r.repliedAt && !r.teacherSeenAt) await this.store.update(`requests/${r.id}`, { teacherSeenAt: at });
  }

  // ───────── ניהול תוכן ─────────
  async adminListTopics(): Promise<Topic[]> { await this.need('admin'); return this.store.list<Topic>('topics'); }
  async adminGetTopic(id: string): Promise<Topic | null> { await this.need('admin'); return this.store.get<Topic>(`topics/${id}`); }
  async adminTopicVersions(id: string): Promise<Topic[]> { await this.need('admin'); return (await this.store.list<Topic>('topicVersions', [['baseId', '==', id]] as any)).sort((a, b) => b.version - a.version); }

  /**
   * שמירת נושא עם גרסה חדשה (גרסה מפורסמת אינה נדרסת) והגנה מעריכה מקבילה.
   * נושא מפורסם חייב לעבור ולידציה של הכללים. אחרי שמירה של נושא מפורסם יש לקרוא ל-publishCatalog.
   */
  async saveTopic(topic: Topic, expectedVersion: number | null): Promise<Topic> {
    const c = await this.need('admin');
    if (topic.publish === 'published') {
      const errs = validateRuleSet(topic.rules, topic.coverage, { ageMin: topic.ageMin, ageMax: topic.ageMax }).filter(i => i.level === 'error');
      if (errs.length) throw new Error(`לא ניתן לפרסם: ${errs.map(e => e.message).join(' ')}`);
      if (!topic.he.trim()) throw new Error('נדרש שם בעברית.');
    }
    return this.store.transact(async tx => {
      const cur = await tx.get<Topic>(`topics/${topic.id}`);
      if (cur && expectedVersion !== null && cur.version !== expectedVersion) throw new ConflictError();
      if (!cur && expectedVersion !== null && expectedVersion !== 0) throw new ConflictError();
      const next: Topic = { ...topic, version: (cur?.version ?? 0) + 1, updatedAt: this.now(), updatedBy: c.user!.uid, sourceMapped: topic.sourceMapped && !cur ? true : false };
      tx.set(`topics/${next.id}`, next);
      tx.set(`topicVersions/${next.id}__v${next.version}`, { ...next, baseId: next.id });
      const a = this.audit('save_topic', `${next.id}@v${next.version}`, c.user!.uid);
      if (a.op === 'set') tx.set(a.path, a.data);
      return next;
    });
  }
  /** מספר הקבוצות הפעילות בנושא: לסיכום השפעה לפני פרסום (ללא שמות או פרטים) */
  async adminActiveGroupsForTopic(topicId: string): Promise<number> {
    await this.need('admin');
    return (await this.store.list<Group>('groups', [['topicId', '==', topicId]])).filter(g => g.status !== 'cancelled').length;
  }
  async setTopicPublish(id: string, publish: Topic['publish'], addedYear?: string | null): Promise<Topic> {
    const t = await this.adminGetTopic(id);
    if (!t) throw new Error('הנושא לא נמצא.');
    return this.saveTopic({ ...t, publish, addedYear: addedYear === undefined ? t.addedYear : addedYear }, t.version);
  }
  /**
   * מפרסם את העותק הציבורי (נושאים, מקורות, "מה נוסף השנה", הגדרות ציבוריות) בפעולה אטומית אחת, ואז קורא אותו בחזרה כדי לוודא שנשמר.
   * אם משהו נכשל, השגיאה מוצגת למנהל והעותק הציבורי נשאר כפי שהיה (לא חצי־מעודכן). טיוטות ונושאים שהוסרו אינם נכללים.
   */
  async publishCatalog(): Promise<{ topics: number; chunks: number; sources: number; newItems: number; generatedAt: number }> {
    const c = await this.need('admin');
    const at = this.now();
    const built = await buildCatalogOps(this.store, at);
    await this.store.batch([...built.ops, this.audit('publish_catalog', `${built.topics} topics, ${built.sources} sources, ${built.newItems} new`, c.user!.uid)]);
    this.snapshotCache?.clear();
    const back = await this.store.get<CatalogMeta>('public/catalogMeta');
    if (!back || back.generatedAt !== at) throw new Error('הפרסום לא אומת: העותק הציבורי לא נקרא בחזרה כפי שנכתב. יש לנסות שוב לפני שמסתמכים על השינוי.');
    return { topics: built.topics, chunks: built.chunks, sources: built.sources, newItems: built.newItems, generatedAt: at };
  }
  /** מה ישתנה בפרסום הבא לעומת מה שהציבור רואה עכשיו (תצוגה מקדימה לפני פרסום) */
  async adminPublishDiff(): Promise<PublishDiff> { await this.need('admin'); return diffAgainstLive(this.store, this.now()); }

  // ───────── "מה נוסף השנה" ─────────
  async adminListNewItems(): Promise<NewItem[]> {
    await this.need('admin');
    return (await this.store.list<NewItem>('newItems')).sort((a, b) => b.publishedAt - a.publishedAt);
  }
  async adminSaveNewItem(input: { id?: string; yearId: string; topicId?: string | null; title: string; text: string; publishedAt?: number; visible: boolean }): Promise<NewItem> {
    const c = await this.need('admin');
    const title = input.title.trim(), text = input.text.trim();
    if (title.length < 3 || title.length > 120) throw new Error('כותרת: 3 עד 120 תווים.');
    if (text.length < 3 || text.length > 600) throw new Error('נדרש תיאור קצר של מה נוסף או השתנה (עד 600 תווים).');
    if (!input.yearId.trim()) throw new Error('נדרשת שנת לימודים.');
    if (looksLikePersonalData(`${title} ${text}`)) throw new Error('נראה שהטקסט כולל מספר זיהוי או כתובת מייל. הרשימה ציבורית ואינה מיועדת לפרטי אדם.');
    const id = input.id ?? `n-${uuid().slice(0, 8)}`;
    const cur = input.id ? await this.store.get<NewItem>(`newItems/${id}`) : null;
    const item: NewItem = stripUndefined({
      id, yearId: input.yearId.trim(), topicId: input.topicId || null, title, text,
      publishedAt: input.publishedAt ?? cur?.publishedAt ?? this.now(), visible: input.visible,
      createdBy: cur?.createdBy ?? c.user!.uid, updatedAt: this.now(),
    });
    await this.store.batch([{ op: 'set', path: `newItems/${id}`, data: item }, this.audit(cur ? 'update_new_item' : 'add_new_item', id, c.user!.uid)]);
    return item;
  }
  async adminDeleteNewItem(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'delete', path: `newItems/${id}` }, this.audit('delete_new_item', id, c.user!.uid)]);
  }
  /** מנהל מוסיף מקור איתור: בלי מכסה יומית, מסומן כנבדק. מתפרסם לציבור בפרסום הבא. */
  async adminAddSource(input: SourceInput): Promise<RecruitmentSource> {
    const c = await this.need('admin');
    const chk = checkSourceInput(input);
    if (!chk.ok || !chk.clean) throw new Error(chk.errors.join(' '));
    const id = `s-${uuid().slice(0, 10)}`;
    const s: RecruitmentSource = stripUndefined({ id, ...chk.clean, createdBy: c.user!.uid, createdAt: this.now(), visible: true, reviewed: true, reviewedBy: c.user!.uid, reviewedAt: this.now() });
    await this.store.batch([{ op: 'set', path: `sources/${id}`, data: s }, this.audit('admin_add_source', id, c.user!.uid)]);
    return s;
  }
  async saveGeneralRules(rules: RuleSet) {
    const c = await this.need('admin');
    const errs = validateRuleSet(rules, { level: 'partial', reason: 'כללי סף' }, { ageMin: null, ageMax: null }).filter(i => i.level === 'error');
    if (errs.length) throw new Error(errs.map(e => e.message).join(' '));
    await this.store.batch([{ op: 'set', path: 'config/general', data: { rules, updatedAt: this.now(), updatedBy: c.user!.uid } }, this.audit('save_general_rules', 'config/general', c.user!.uid)]);
  }
  async saveVocab(systems: SystemDef[], tags: TagDef[]) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'set', path: 'config/vocab', data: { systems, tags } }, this.audit('save_vocab', 'config/vocab', c.user!.uid)]);
  }
  async saveSettings(s: Settings) {
    const c = await this.need('admin');
    const { responsibleEmail, responsibleName, ...pub } = s;
    await this.store.batch([
      { op: 'set', path: 'config/settings', data: { ...pub, responsibleEmail: '', responsibleName: '' } },
      { op: 'set', path: 'config/contact', data: { email: responsibleEmail, name: responsibleName } },
      this.audit('save_settings', 'config/settings', c.user!.uid),
    ]);
  }
  async getAdminSettings(): Promise<Settings> {
    await this.need('admin');
    const [s, contact] = await Promise.all([this.store.get<Settings>('config/settings'), this.store.get<{ email: string; name: string }>('config/contact')]);
    return { ...defaultSettings(new Date(this.now())), ...(s ?? {}), responsibleEmail: contact?.email ?? '', responsibleName: contact?.name ?? '' };
  }
  async getYear(id: string): Promise<AcademicYear | null> {
    const d = await this.store.get<{ years: AcademicYear[] }>('config/years');
    return d?.years.find(y => y.id === id) ?? null;
  }
  async saveYears(years: AcademicYear[]) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'set', path: 'config/years', data: { years } }, this.audit('save_years', 'config/years', c.user!.uid)]);
  }
  // שאלות מקצועיות פתוחות (סעיף 25)
  async listPolicyQuestions(): Promise<PolicyQuestion[]> { return this.store.list<PolicyQuestion>('policyQuestions'); }
  async savePolicyQuestion(q: PolicyQuestion) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'set', path: `policyQuestions/${q.id}`, data: q }, this.audit('save_policy_question', q.id, c.user!.uid)]);
  }
  // הצעות (תיוג, נושאים, עדכוני מקור) ממתינות להכרעת מנהל (R05)
  async listSuggestions(): Promise<any[]> { await this.need('admin'); return this.store.list('suggestions'); }
  async resolveSuggestion(id: string, state: 'accepted' | 'rejected') {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `suggestions/${id}`, data: { state, resolvedBy: c.user!.uid, resolvedAt: this.now() } }, this.audit(`suggestion_${state}`, id, c.user!.uid)]);
  }

  // ───────── ייבוא מיפוי 114 הרשומות (חוזר־בטוח) ─────────
  async previewSeedImport() {
    await this.need('admin');
    const recs = new Map((await this.store.list<SeedRecord>('seedEntries')).map(r => [r.seedId, r]));
    const topicIds = new Set((await this.store.list<Topic>('topics')).map(t => t.id));
    return planSeedImport(SEED, recs, SEED_AUX, this.now(), topicIds);
  }
  async applySeedImport() {
    const c = await this.need('admin');
    const plan = await this.previewSeedImport();
    const ops: BatchOp[] = [];
    for (const t of plan.createTopics) { ops.push({ op: 'set', path: `topics/${t.id}`, data: t }); ops.push({ op: 'set', path: `topicVersions/${t.id}__v1`, data: { ...t, baseId: t.id } }); }
    for (const r of plan.upsertSeedRecords) ops.push({ op: 'set', path: `seedEntries/${r.seedId}`, data: r });
    for (const s of plan.suggestions) ops.push({ op: 'set', path: `suggestions/${s.id}`, data: s });
    ops.push(this.audit('seed_import', `${plan.createTopics.length} new, ${plan.suggestions.length} suggestions`, c.user!.uid));
    await this.store.batch(ops);
    return plan;
  }

  // ───────── מוסדות ─────────
  async adminListSchools(): Promise<School[]> { await this.need('coordinator'); return this.store.list<School>('schools'); }
  async adminPreviewSchools(csv: string) {
    await this.need('admin');
    const ex = new Map((await this.store.list<School>('schools')).map(s => [s.id, s]));
    return previewSchoolImport(csv, ex);
  }
  async adminApplySchools(csv: string) {
    const c = await this.need('admin');
    const rows = await this.adminPreviewSchools(csv);
    const ok = rows.filter(r => r.status === 'new' || r.status === 'update');
    // עדכון שם אינו משנה את הקוד או את ההיסטוריה (סעיף 16.1)
    await this.store.batch([...ok.map(r => ({ op: 'set', path: `schools/${r.school.id}`, data: r.school }) as BatchOp), this.audit('import_schools', `${ok.length} rows`, c.user!.uid)]);
    return { applied: ok.length, rejected: rows.length - ok.length };
  }
  async adminSaveSchool(s: School) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'set', path: `schools/${s.id}`, data: s }, this.audit('save_school', s.id, c.user!.uid)]);
  }
  /** רכז או מנהל מתקן היסטוריית מוסד (סעיף 4.3) */
  async correctHistory(schoolId: string, yearId: string, items: SchoolYearHistory['items']) {
    const c = await this.need('coordinator');
    if (c.role === 'coordinator' && c.roleDoc?.schoolId !== schoolId) throw new PermissionError();
    await this.store.batch([{ op: 'set', path: `schoolHistory/${schoolId}_${yearId}`, data: { schoolId, yearId, items, updatedAt: this.now() } }, this.audit('correct_history', `${schoolId}_${yearId}`, c.user!.uid, 'coordinator')]);
  }

  // ───────── מורים מאושרים מראש (רשימת הפיקוח) ─────────
  /**
   * רשימת כתובות שהפיקוח אישר. הגישה נקבעת כך: משתמש שנרשם במייל כלשהו ואימת שהוא שולט בכתובת, וכתובתו ברשימה פעילה.
   * הקלדת כתובת בלבד אינה מקנה דבר. ביטול גישה חל מיד, גם על מי שמחובר כרגע (הכללים בודקים בכל בקשה).
   */
  async adminListTeachers(): Promise<(AllowedTeacher & { status: 'pending' | 'active' | 'revoked' })[]> {
    await this.need('admin');
    const [list, profiles] = await Promise.all([this.store.list<AllowedTeacher>('allowedTeachers'), this.store.list<Profile>('profiles')]);
    const registered = new Set(profiles.filter(p => p.emailVerified).map(p => normEmail(p.email)));
    return list.map(t => ({ ...t, status: !t.active ? 'revoked' as const : registered.has(t.id) ? 'active' as const : 'pending' as const })).sort((a, b) => a.email.localeCompare(b.email));
  }
  private async checkSchools(ids: string[]) {
    for (const id of ids) {
      const s = await this.store.get<School>(`schools/${id}`);
      if (!s || !s.active) throw new Error(`קוד מוסד לא קיים או לא פעיל: ${id}`);
    }
  }
  async adminSaveTeacher(input: { email: string; name?: string; schoolIds?: string[]; note?: string }): Promise<AllowedTeacher> {
    this.clearCtxCache();
    const c = await this.need('admin');
    const email = normEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new Error('כתובת מייל לא תקינה.');
    const schoolIds = [...new Set((input.schoolIds ?? []).map(s => s.trim()).filter(Boolean))];
    await this.checkSchools(schoolIds);
    const cur = await this.store.get<AllowedTeacher>(`allowedTeachers/${email}`);
    const t: AllowedTeacher = stripUndefined({
      id: email, email, name: (input.name ?? cur?.name ?? '').trim().slice(0, 80), schoolIds, active: cur ? cur.active : true,
      note: (input.note ?? cur?.note ?? '').trim().slice(0, 200) || undefined,
      addedBy: cur?.addedBy ?? c.user!.uid, addedAt: cur?.addedAt ?? this.now(),
      revokedAt: cur?.revokedAt, revokedBy: cur?.revokedBy, revokedReason: cur?.revokedReason,
    });
    await this.store.batch([{ op: 'set', path: `allowedTeachers/${email}`, data: t }, this.audit(cur ? 'teacher_update' : 'teacher_add', email, c.user!.uid)]);
    return t;
  }
  async adminPreviewTeacherImport(csv: string) {
    await this.need('admin');
    const [ex, schools] = await Promise.all([this.store.list<AllowedTeacher>('allowedTeachers'), this.store.list<School>('schools')]);
    return previewTeacherImport(csv, new Map(ex.map(t => [t.id, t])), new Set(schools.filter(s => s.active).map(s => s.id)));
  }
  async adminApplyTeacherImport(csv: string): Promise<{ added: number; updated: number; skipped: number }> {
    this.clearCtxCache();
    const c = await this.need('admin');
    const rows = await this.adminPreviewTeacherImport(csv);
    const ex = new Map((await this.store.list<AllowedTeacher>('allowedTeachers')).map(t => [t.id, t]));
    const ops: BatchOp[] = [];
    let added = 0, updated = 0;
    for (const r of rows) {
      if (r.status !== 'new' && r.status !== 'update') continue;
      const cur = ex.get(r.email);
      const t: AllowedTeacher = stripUndefined({ id: r.email, email: r.email, name: r.name || cur?.name || '', schoolIds: r.schoolIds, active: true, note: cur?.note, addedBy: cur?.addedBy ?? c.user!.uid, addedAt: cur?.addedAt ?? this.now() });
      ops.push({ op: 'set', path: `allowedTeachers/${r.email}`, data: t });
      if (r.status === 'new') added++; else updated++;
    }
    ops.push(this.audit('teacher_import', `${added} new, ${updated} updated`, c.user!.uid));
    await this.store.batch(ops);
    return { added, updated, skipped: rows.length - added - updated };
  }
  /** ביטול גישה (למשל מורה שעזב): חל מיד. הקבוצות והתוכן שהוסיף נשארים ונראים למנהל ולרכז. */
  async adminRevokeTeacher(email: string, reason = '') {
    this.clearCtxCache();
    const c = await this.need('admin');
    const id = normEmail(email);
    if (!(await this.store.get(`allowedTeachers/${id}`))) throw new Error('הכתובת אינה ברשימה.');
    await this.store.batch([{ op: 'update', path: `allowedTeachers/${id}`, data: { active: false, revokedAt: this.now(), revokedBy: c.user!.uid, revokedReason: reason.trim().slice(0, 200) } }, this.audit('teacher_revoke', id, c.user!.uid)]);
  }
  async adminRestoreTeacher(email: string) {
    this.clearCtxCache();
    const c = await this.need('admin');
    const id = normEmail(email);
    const cur = await this.store.get<AllowedTeacher>(`allowedTeachers/${id}`);
    if (!cur) throw new Error('הכתובת אינה ברשימה.');
    const { revokedAt, revokedBy, revokedReason, ...rest } = cur as AllowedTeacher & { id: string };
    void revokedAt; void revokedBy; void revokedReason;
    const { id: _i, ...data } = rest;
    await this.store.batch([{ op: 'set', path: `allowedTeachers/${id}`, data: { ...data, active: true } }, this.audit('teacher_restore', id, c.user!.uid)]);
  }
  async adminDeleteTeacher(email: string) {
    this.clearCtxCache();
    const c = await this.need('admin');
    const id = normEmail(email);
    await this.store.batch([{ op: 'delete', path: `allowedTeachers/${id}` }, this.audit('teacher_delete', id, c.user!.uid)]);
  }

  /** מי הגיש: פענוח מזהה משתמש (שמור במקור ובבקשה) לשם ולמייל. המקורות ציבוריים ולכן אינם מכילים שם או מייל. מנהל בלבד. */
  async adminProfileNames(): Promise<Map<string, { name: string; email: string }>> {
    await this.need('admin');
    return new Map((await this.store.list<Profile>('profiles')).map(p => [p.uid, { name: p.displayName, email: p.email }]));
  }

  // ───────── משתמשים והרשאות ─────────
  async adminListProfiles(): Promise<(Profile & { roleDoc: RoleDoc | null })[]> {
    await this.need('admin');
    const [ps, rs] = await Promise.all([this.store.list<Profile>('profiles'), this.store.list<RoleDoc & { id: string }>('roles')]);
    const rmap = new Map(rs.map(r => [r.id, r]));
    return ps.map(p => ({ ...p, roleDoc: rmap.get(p.uid) ?? null }));
  }
  /** קידום רק מתוך משתמשים רשומים ומאומתים, לא לפי כתובת שהוקלדה. מונע טעות הקלדה שמעניקה ניהול לזר. */
  async adminGrantRole(uid: string, role: Role, schoolId?: string) {
    this.clearCtxCache();
    const c = await this.need('admin');
    const p = await this.store.get<Profile>(`profiles/${uid}`);
    if (!p) throw new Error('המשתמש לא נמצא. הוא צריך להירשם ולאמת את כתובתו תחילה.');
    if (!p.emailVerified) throw new Error('כתובת המשתמש טרם אומתה.');
    if (role === 'coordinator' && !schoolId) throw new Error('רכז חייב להיות משויך למוסד.');
    const d: RoleDoc = stripUndefined({ role, schoolId: role === 'coordinator' ? schoolId : undefined, grantedBy: c.user!.uid, grantedAt: this.now() });
    await this.store.batch([{ op: 'set', path: `roles/${uid}`, data: d }, this.audit(`grant_${role}`, uid, c.user!.uid)]);
  }
  async adminRevokeRole(uid: string) {
    this.clearCtxCache();
    const c = await this.need('admin');
    const cur = await this.store.get<RoleDoc>(`roles/${uid}`);
    if (cur?.role === 'admin') {
      const admins = (await this.store.list<RoleDoc>('roles', [['role', '==', 'admin']]));
      if (admins.length <= 1) throw new Error('לא ניתן להסיר את המנהל האחרון.');
    }
    await this.store.batch([{ op: 'delete', path: `roles/${uid}` }, this.audit('revoke_role', uid, c.user!.uid)]);
  }

  // ───────── סיום מחזור ומחיקה (סעיף 17) ─────────
  /**
   * תצוגה מקדימה לפני מחיקה: מה יושפע, בלי לשנות דבר. קוראת את קבוצות המחזור ואת הבקשות המקושרות בלבד.
   * "פעילות" = קבוצה שלא סומנה כבוצעה או כבוטלה: מחיקתה נרשמת בהיסטוריה כ"אושר ולא בוצע".
   */
  async cycleClosePreview(yearId: string) {
    await this.need('admin');
    const gs = await this.store.list<Group>('groups', [['yearId', '==', yearId]]);
    const ids = new Set(gs.map(g => g.id));
    const byStatus: Record<string, number> = {};
    gs.forEach(g => { byStatus[g.status] = (byStatus[g.status] ?? 0) + 1; });
    const schools = new Set(gs.map(g => g.schoolId));
    const year = await this.getYear(yearId);
    const ledger = await this.store.get<{ deletedAt: number; groupsDeleted: number }>(`deletionLedger/${yearId}`);
    const linkedRequests = ids.size === 0 ? 0 : (await this.store.list<RequestDoc>('requests')).filter(r => r.groupId && ids.has(r.groupId)).length;
    const today = new Date(this.now()).toISOString().slice(0, 10);
    return {
      yearId, alreadyClosed: !!ledger || !!year?.closed, closedAt: ledger?.deletedAt ?? null,
      groups: gs.length, schools: schools.size,
      withNames: gs.filter(g => g.students.some(s => s.label.trim())).length,
      studentLabels: gs.reduce((n, g) => n + g.students.filter(s => s.label.trim()).length, 0),
      byStatus,
      activeGroups: gs.filter(g => g.status !== 'done' && g.status !== 'cancelled').length,
      historyRecordsToWrite: gs.filter(g => g.topicId).length,
      linkedRequests,
      yearEnded: year ? today > year.end : null,
      yearEnd: year?.end ?? null,
    };
  }
  /** תאימות לאחור לשם הישן */
  async cycleCloseSummary(yearId: string) { const p = await this.cycleClosePreview(yearId); return { groups: p.groups, byStatus: p.byStatus, withNames: p.withNames }; }
  /**
   * סגירת מחזור: מעדכן היסטוריה לא מזהה (מוסד/שנה/נושא/מצב), מוחק את כל הקבוצות של המחזור (ושמות התלמידים שבתוכן),
   * מנתק הפניות קבוצה מבקשות, ורושם יומן מחיקות שמונע החזרה בשחזור. ניתן להרצה חוזרת בבטחה.
   * מחזור שטרם הסתיים (לפי תאריך הסיום שהוגדר) נסגר רק עם force מפורש.
   * הכתיבה בקבוצות של עד 400 פעולות: אם נקטעה באמצע, הרצה חוזרת משלימה (היומן נכתב אחרון).
   */
  async closeCycle(yearId: string, opts: { force?: boolean } = {}): Promise<{ deleted: number }> {
    const c = await this.need('admin');
    const year = await this.getYear(yearId);
    if (year && !opts.force && new Date(this.now()).toISOString().slice(0, 10) <= year.end) throw new Error(`המחזור ${yearId} טרם הסתיים (עד ${year.end}). סגירה לפני הסיום מוחקת עבודות פעילות; אם זה מכוון, יש לאשר במפורש.`);
    const gs = await this.store.list<Group>('groups', [['yearId', '==', yearId]]);
    const bySchool = new Map<string, Group[]>();
    gs.forEach(g => bySchool.set(g.schoolId, [...(bySchool.get(g.schoolId) ?? []), g]));
    const historyOps: BatchOp[] = [];
    const topics = new Map((await this.store.list<Topic>('topics')).map(t => [t.id, t]));
    for (const [schoolId, groups] of bySchool) {
      const id = `${schoolId}_${yearId}`;
      const h = await this.store.get<SchoolYearHistory>(`schoolHistory/${id}`);
      const items = (h?.items ?? []).filter(i => !groups.some(g => g.id === i.groupId));
      for (const g of groups) {
        if (!g.topicId) continue;
        const t = topics.get(g.topicId);
        const prior = h?.items.find(i => i.groupId === g.id);
        items.push({
          groupId: g.id, topicId: g.topicId, familyId: t?.familyId ?? prior?.familyId ?? `fam-${g.topicId}`, topicHe: t?.he ?? prior?.topicHe ?? '',
          state: g.status === 'done' ? 'done' : g.status === 'cancelled' ? 'cancelled' : 'approved_not_done',
        });
      }
      historyOps.push({ op: 'set', path: `schoolHistory/${id}`, data: { schoolId, yearId, items, updatedAt: this.now() } });
    }
    const ops: BatchOp[] = [...historyOps];
    for (const r of await this.store.list<RequestDoc>('requests')) if (r.groupId && gs.some(g => g.id === r.groupId)) ops.push({ op: 'update', path: `requests/${r.id}`, data: { groupId: '' } });
    for (const g of gs) ops.push({ op: 'delete', path: `groups/${g.id}` });
    const years = (await this.store.get<{ years: AcademicYear[] }>('config/years'))?.years ?? defaultYears(new Date(this.now()));
    ops.push({ op: 'set', path: 'config/years', data: { years: years.map(y => (y.id === yearId ? { ...y, closed: true } : y)) } });
    ops.push({ op: 'set', path: `deletionLedger/${yearId}`, data: { yearId, deletedAt: this.now(), groupsDeleted: gs.length } });
    ops.push(this.audit('close_cycle', `${yearId} (${gs.length} groups)`, c.user!.uid));
    await this.store.batch(ops);
    return { deleted: gs.length };
  }
  /** שנות לימוד שנסגרו: לפי היומן החי וגם לפי יומן שמגיע מגיבוי. */
  private async closedYears(extra: { yearId: string }[] = []): Promise<Set<string>> {
    const live = await this.store.list<{ yearId: string }>('deletionLedger');
    return new Set([...live, ...extra].map(l => (l as any).yearId ?? (l as any).id));
  }
  /** מוחק קבוצות של שנות לימוד שנסגרו (למקרה שחזרו באיזושהי דרך). */
  async reapplyDeletions(): Promise<{ deleted: number }> {
    await this.need('admin');
    let deleted = 0;
    const ops: BatchOp[] = [];
    for (const y of await this.closedYears()) for (const g of await this.store.list<Group>('groups', [['yearId', '==', y]])) { ops.push({ op: 'delete', path: `groups/${g.id}` }); deleted++; }
    if (ops.length) await this.store.batch(ops);
    return { deleted };
  }

  // ───────── גיבוי ושחזור ידניים (סעיף 20.1) ─────────
  /**
   * גיבוי תוכן: נושאים, גרסאות, הגדרות, מוסדות, היסטוריית נושאים, מקורות, בירורים מקצועיים, הצעות, יומן מחיקות.
   * גיבוי פרטי מוסיף: קבוצות (כינויי תלמידים), בקשות, דיווחי מקורות, חברויות, תפקידים ופרופילים (שם ומייל).
   * אינו כולל: חשבונות הכניסה עצמם (Firebase Authentication: סיסמאות ומיילים), יומן הפעולות (audit), וקבצים (אין בכלי).
   */
  async exportBackup(includePrivate = false): Promise<BackupFile> {
    const c = await this.need('admin');
    const data: Record<string, any[]> = {};
    for (const coll of includePrivate ? [...BACKUP_CONTENT, ...BACKUP_PRIVATE] : BACKUP_CONTENT) data[coll] = await this.store.list(coll);
    // פרטי הקשר של האחראי ומטא־נתוני גיבוי אינם חלק מגיבוי תוכן
    if (!includePrivate) data.config = (data.config ?? []).filter((d: any) => d.id !== 'contact');
    data.config = (data.config ?? []).filter((d: any) => d.id !== 'backupMeta');
    const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
    const createdAt = this.now();
    await this.store.set('config/backupMeta', { lastBackupAt: createdAt, lastBackupPrivate: includePrivate, by: c.user!.uid });
    return { format: BACKUP_FORMAT, createdAt, includesPrivate: includePrivate, counts, data };
  }
  async getBackupMeta(): Promise<{ lastBackupAt: number; lastBackupPrivate: boolean } | null> {
    await this.need('admin');
    return this.store.get('config/backupMeta');
  }
  /**
   * תכנון שחזור (בלי לכתוב). לכל אוסף: חדשים (חסרים במערכת), זהים, שונים, וכאלה שנשארים כפי שהם במערכת.
   * מצב add_missing (ברירת מחדל): מוסיף רק מה שחסר ואינו דורס דבר.
   * מצב overwrite: דורס מסמכים שונים, חוץ מ: נושא שגרסתו במערכת חדשה יותר, גרסאות שמורות (אינן נדרסות לעולם),
   * והיסטוריית שנת לימודים שנסגרה. אף מצב אינו מוחק מסמכים שקיימים רק במערכת.
   * קבוצות של שנת לימודים שנסגרה (לפי היומן במערכת או בגיבוי) אינן משוחזרות כלל: שמות התלמידים אינם חוזרים.
   */
  private async planRestore(b: BackupFile, mode: RestoreMode) {
    const closed = await this.closedYears((b.data.deletionLedger ?? []) as { yearId: string }[]);
    const report: Record<string, { backup: number; add: number; same: number; overwrite: number; keptLive: number; skippedClosed: number; liveOnly: number }> = {};
    const ops: BatchOp[] = [];
    for (const [coll, docs] of Object.entries(b.data)) {
      if (!BACKUP_ALLOWED.has(coll)) continue; // אוספים לא מוכרים אינם נכתבים
      const live = new Map((await this.store.list<any>(coll)).map(d => [d.id, d]));
      const r = report[coll] = { backup: docs.length, add: 0, same: 0, overwrite: 0, keptLive: 0, skippedClosed: 0, liveOnly: 0 };
      const seen = new Set<string>();
      for (const d of docs) {
        const { id, ...rest } = d; seen.add(id);
        if (coll === 'groups' && closed.has(rest.yearId)) { r.skippedClosed++; continue; }
        const cur = live.get(id);
        if (!cur) { r.add++; ops.push({ op: 'set', path: `${coll}/${id}`, data: rest }); continue; }
        const { id: _i, ...curRest } = cur;
        if (stable(curRest) === stable(rest)) { r.same++; continue; }
        const keep = mode === 'add_missing' || coll === 'topicVersions'
          || (coll === 'topics' && (cur.version ?? 0) > (rest.version ?? 0))
          || (coll === 'schoolHistory' && closed.has(rest.yearId ?? cur.yearId))
          || (coll === 'deletionLedger');
        if (keep) { r.keptLive++; continue; }
        r.overwrite++; ops.push({ op: 'set', path: `${coll}/${id}`, data: rest });
      }
      r.liveOnly = [...live.keys()].filter(k => !seen.has(k)).length;
    }
    return { ops, report, closedYears: [...closed] };
  }
  async previewRestore(b: BackupFile, mode: RestoreMode = 'add_missing') {
    await this.need('admin');
    this.checkBackupFormat(b);
    const p = await this.planRestore(b, mode);
    return { mode, writes: p.ops.length, report: p.report, closedYears: p.closedYears, createdAt: b.createdAt, includesPrivate: b.includesPrivate };
  }
  private checkBackupFormat(b: { format: string; data?: unknown }) {
    if ((b.format !== 'mat-backup-1' && b.format !== BACKUP_FORMAT) || typeof b.data !== 'object' || !b.data) throw new Error('פורמט גיבוי לא מוכר.');
  }
  /** שחזור. כתיבה בקבוצות של 400; אם נקטע באמצע, הרצה חוזרת (באותו מצב) משלימה בלי לדרוס. */
  async restoreBackup(b: BackupFile | { format: string; data: Record<string, any[]> }, opts: { mode?: RestoreMode } = {}): Promise<{ restored: number; reDeleted: number; mode: RestoreMode }> {
    this.clearCtxCache();
    const c = await this.need('admin');
    this.checkBackupFormat(b);
    const mode = opts.mode ?? 'add_missing';
    const p = await this.planRestore(b as BackupFile, mode);
    await this.store.batch([...p.ops, this.audit('restore_backup', `${mode}: ${p.ops.length} writes`, c.user!.uid)]);
    const { deleted } = await this.reapplyDeletions();
    return { restored: p.ops.length, reDeleted: deleted, mode };
  }
}

export type RestoreMode = 'add_missing' | 'overwrite';
export const BACKUP_FORMAT = 'mat-backup-2';
export interface BackupFile { format: 'mat-backup-1' | 'mat-backup-2'; createdAt: number; includesPrivate: boolean; counts?: Record<string, number>; data: Record<string, any[]> }
const BACKUP_CONTENT = ['topics', 'topicVersions', 'config', 'public', 'schools', 'schoolHistory', 'policyQuestions', 'sources', 'seedEntries', 'deletionLedger', 'suggestions'];
const BACKUP_PRIVATE = ['groups', 'requests', 'sourceReports', 'allowedTeachers', 'roles', 'profiles'];
const BACKUP_ALLOWED = new Set([...BACKUP_CONTENT, ...BACKUP_PRIVATE]);
/** השוואה יציבה בין מסמכים (סדר מפתחות לא משנה) */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
