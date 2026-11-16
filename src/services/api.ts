import { validateRuleSet } from '../engine/validate';
import { DEFAULT_GENERAL_RULES } from '../engine/general';
import type { RuleSet } from '../engine/types';
import { checkSourceInput, dueAtFor, looksLikePersonalData, SourceInput } from '../domain/helpers';
import { previewSchoolImport } from '../domain/csv';
import { planSeedImport, SeedRecord } from '../domain/seedImport';
import type {
  AcademicYear, AuditEvent, Catalog, Group, GroupStatus, Membership, NotificationDoc, OutboxDoc, PolicyQuestion,
  Profile, RecruitmentSource, RequestDoc, RequestKind, Role, RoleDoc, School, SchoolYearHistory, Settings, SystemDef, TagDef, Topic,
} from '../domain/types';
import type { AuthService, AuthUser } from './auth';
import { buildBundledCatalog, DEFAULT_TAGS, defaultSettings, defaultYears, SEED, SEED_AUX } from './bundled';
import { BatchOp, ConflictError, PermissionError, Store } from './store';
import { buildCatalogOps } from './catalog';

export type Mode = 'service' | 'demo' | 'bundled';

export interface Ctx { user: AuthUser | null; role: Role | null; roleDoc: RoleDoc | null; verified: boolean }

export interface Mailer { send(to: string, subject: string, body: string): Promise<void> }

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
  async ctx(): Promise<Ctx> {
    const user = this.auth.current();
    if (!user) return { user: null, role: null, roleDoc: null, verified: false };
    let roleDoc: RoleDoc | null = null;
    try { roleDoc = await this.store.get<RoleDoc>(`roles/${user.uid}`); } catch { /* אין הרשאה/שירות */ }
    return { user, role: roleDoc?.role ?? (user.emailVerified ? 'teacher' : null), roleDoc, verified: user.emailVerified };
  }
  private async need(min: 'verified' | 'coordinator' | 'admin'): Promise<Ctx> {
    const c = await this.ctx();
    if (!c.user) throw new PermissionError('יש להתחבר.');
    if (!c.verified) throw new PermissionError('יש לאמת את כתובת המייל לפני ביצוע הפעולה.');
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
  async loadCatalog(): Promise<Catalog> {
    if (this.mode === 'bundled') return buildBundledCatalog(this.now());
    try {
      const meta = await this.store.get<{ chunks: number; generatedAt: number }>('public/catalogMeta');
      if (!meta) {
        if (this.mode === 'service') return { ...buildBundledCatalog(this.now()), origin: 'bundled' };
        throw new Error('catalog not published');
      }
      const topics: Topic[] = [];
      for (let i = 0; i < meta.chunks; i++) {
        const c = await this.store.get<{ topics: Topic[] }>(`public/catalog_${i}`);
        if (c) topics.push(...c.topics);
      }
      const [general, vocab, settings, years] = await Promise.all([
        this.store.get<{ rules: RuleSet }>('config/general'),
        this.store.get<{ systems: SystemDef[]; tags: TagDef[] }>('config/vocab'),
        this.store.get<Settings>('config/settings'),
        this.store.get<{ years: AcademicYear[] }>('config/years'),
      ]);
      return {
        topics, generalRules: general?.rules ?? DEFAULT_GENERAL_RULES,
        systems: vocab?.systems ?? SEED_AUX.systems, tags: vocab?.tags ?? DEFAULT_TAGS,
        settings: { ...defaultSettings(new Date(this.now())), ...(settings ?? {}) },
        years: years?.years ?? defaultYears(new Date(this.now())),
        generatedAt: meta.generatedAt, origin: this.mode === 'demo' ? 'demo' : 'service',
      };
    } catch (e) {
      if (this.mode === 'service') return { ...buildBundledCatalog(this.now()), origin: 'bundled' };
      throw e;
    }
  }
  async listSources(): Promise<RecruitmentSource[]> {
    return this.store.list<RecruitmentSource>('sources', [['visible', '==', true]]);
  }
  async getSchoolHistory(schoolId: string, yearId: string): Promise<SchoolYearHistory | null> {
    return this.store.get<SchoolYearHistory>(`schoolHistory/${schoolId}_${yearId}`);
  }
  async getSchool(code: string): Promise<School | null> { return this.store.get<School>(`schools/${code.trim()}`); }
  async getContact(): Promise<{ email: string; name: string } | null> {
    const c = await this.ctx();
    if (!c.user || !c.verified) return null;
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
  async myMemberships(): Promise<(Membership & { school: School | null })[]> {
    const c = await this.ctx();
    if (!c.user) return [];
    const ms = await this.store.list<Membership>('memberships', [['uid', '==', c.user.uid]]);
    const out = [];
    for (const m of ms.filter(x => x.endedAt === null)) out.push({ ...m, school: await this.store.get<School>(`schools/${m.schoolId}`) });
    return out;
  }
  /** הצטרפות למוסד בקוד: מקנה עיון בהיסטוריה ויצירת קבוצות במוסד, לא הרשאת רכז (T31). */
  async joinSchool(code: string): Promise<Membership> {
    const c = await this.need('verified');
    const school = await this.store.get<School>(`schools/${code.trim()}`);
    if (!school || !school.active) throw new Error('קוד מוסד לא נמצא. אפשר לבקש מהאחראי להוסיף את המוסד.');
    const m: Membership = { id: `${c.user!.uid}_${school.id}`, uid: c.user!.uid, schoolId: school.id, startedAt: this.now(), endedAt: null };
    await this.store.set(`memberships/${m.id}`, m);
    return m;
  }
  async leaveSchool(membershipId: string) {
    const c = await this.need('verified');
    const m = await this.store.get<Membership>(`memberships/${membershipId}`);
    if (!m || (m.uid !== c.user!.uid && c.role !== 'admin' && !(c.role === 'coordinator' && c.roleDoc?.schoolId === m.schoolId))) throw new PermissionError();
    await this.store.update(`memberships/${membershipId}`, { endedAt: this.now() });
  }

  // ───────── קבוצות ─────────
  async listMyGroups(): Promise<Group[]> {
    const c = await this.need('verified');
    return (await this.store.list<Group>('groups', [['ownerUid', '==', c.user!.uid]])).sort((a, b) => b.createdAt - a.createdAt);
  }
  async listSchoolGroups(schoolId: string): Promise<Group[]> {
    const c = await this.need('coordinator');
    if (c.role === 'coordinator' && c.roleDoc?.schoolId !== schoolId) throw new PermissionError();
    return this.store.list<Group>('groups', [['schoolId', '==', schoolId]]);
  }
  async createGroup(input: { schoolId: string; yearId: string; studentCount: number; students?: string[]; topicId?: string | null; clientId?: string }): Promise<Group> {
    const c = await this.need('verified');
    if (![1, 2, 3].includes(input.studentCount)) throw new Error('מספר התלמידים חייב להיות 1, 2 או 3.');
    const labels = (input.students ?? []).map(s => s.trim()).filter(Boolean);
    if (labels.length > input.studentCount) throw new Error('מספר השמות גדול ממספר התלמידים.');
    for (const l of labels) { const e = checkStudentLabel(l); if (e) throw new Error(e); }
    const members = await this.myMemberships();
    if (!members.some(m => m.schoolId === input.schoolId)) throw new PermissionError('יש להצטרף למוסד בקוד לפני יצירת קבוצה.');
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
    const c = await this.need('verified');
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

  // ───────── מקורות איתור (סעיף 13) ─────────
  /** פרסום מיידי + התראה למנהל באותה פעולה אטומית. חוזר־בטוח לפי clientId. */
  async addSource(input: SourceInput & { clientId?: string }): Promise<RecruitmentSource> {
    const c = await this.need('verified');
    const chk = checkSourceInput(input);
    if (!chk.ok || !chk.clean) throw new Error(chk.errors.join(' '));
    const id = input.clientId ?? uuid();
    const exists = await this.store.get<RecruitmentSource>(`sources/${id}`);
    if (exists) return exists;
    const s: RecruitmentSource = { id, ...chk.clean, createdBy: c.user!.uid, createdAt: this.now(), visible: true };
    await this.store.batch([
      { op: 'set', path: `sources/${id}`, data: s },
      ...this.notify('source_added', id, `נוסף מקור איתור: ${s.title}`, s.topicId, id),
    ]);
    return s;
  }
  async reportSource(sourceId: string, reason: string) {
    await this.need('verified');
    const id = `rep-${sourceId}-${uuid().slice(0, 6)}`;
    await this.store.batch(this.notify('source_reported', sourceId, `דיווח על מקור: ${reason.slice(0, 200)}`, undefined, id));
  }
  async adminEditSource(id: string, patch: Partial<Pick<RecruitmentSource, 'title' | 'text' | 'url' | 'phone' | 'region' | 'population' | 'kind' | 'topicId'>>) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { ...patch, editedBy: c.user!.uid, editedAt: this.now() } }, this.audit('edit_source', id, c.user!.uid)]);
  }
  async adminRemoveSource(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { visible: false, editedBy: c.user!.uid, editedAt: this.now() } }, this.audit('remove_source', id, c.user!.uid)]);
  }
  async adminRestoreSource(id: string) {
    const c = await this.need('admin');
    await this.store.batch([{ op: 'update', path: `sources/${id}`, data: { visible: true, editedBy: c.user!.uid, editedAt: this.now() } }, this.audit('restore_source', id, c.user!.uid)]);
  }
  async adminListSources(): Promise<RecruitmentSource[]> { await this.need('admin'); return this.store.list<RecruitmentSource>('sources'); }

  // ───────── התראות ודוא"ל ─────────
  private notify(type: NotificationDoc['type'], refId: string, summary: string, topicId?: string, key?: string): BatchOp[] {
    const k = key ?? refId;
    const n: NotificationDoc = { id: `n-${k}`, type, refId, topicId, createdAt: this.now(), readBy: [], summary };
    const o: OutboxDoc = { id: `o-${k}`, to: 'admins', subject: `[מאגר נושאים] ${summary.slice(0, 80)}`, body: `${summary}\nלפרטים היכנסו לאזור הניהול באתר.`, status: 'queued', attempts: 0, createdAt: this.now() };
    return [{ op: 'set', path: `notifications/${n.id}`, data: stripUndefined(n) }, { op: 'set', path: `outbox/${o.id}`, data: o }];
  }
  async listNotifications(): Promise<NotificationDoc[]> { await this.need('admin'); return (await this.store.list<NotificationDoc>('notifications')).sort((a, b) => b.createdAt - a.createdAt); }
  async markNotificationRead(id: string) {
    const c = await this.need('admin');
    const n = await this.store.get<NotificationDoc>(`notifications/${id}`);
    if (n && !n.readBy.includes(c.user!.uid)) await this.store.update(`notifications/${id}`, { readBy: [...n.readBy, c.user!.uid] });
  }
  async listOutbox(): Promise<OutboxDoc[]> { await this.need('admin'); return (await this.store.list<OutboxDoc>('outbox')).sort((a, b) => b.createdAt - a.createdAt); }
  /**
   * שליחת תור הדוא"ל דרך Mailer. בדפדפן אין Mailer אמיתי; השליחה האמיתית נעשית בסקריפט scripts/send-outbox.mjs.
   * הסטטוס "sent" נקבע רק אם ה-Mailer החזיר הצלחה. כשל נשמר, וההחלטה אינה אובדת.
   */
  async processOutbox(mailer: Mailer, recipients: { admins: string[]; teachers: Record<string, string> }): Promise<{ sent: number; failed: number }> {
    await this.need('admin');
    let sent = 0, failed = 0;
    for (const o of await this.store.list<OutboxDoc>('outbox', [['status', 'in', ['queued', 'failed']]])) {
      const to = o.to === 'admins' ? recipients.admins : [recipients.teachers[o.toUid ?? ''] ?? ''].filter(Boolean);
      if (to.length === 0) { await this.store.update(`outbox/${o.id}`, { status: 'failed', attempts: o.attempts + 1 }); failed++; continue; }
      try { for (const addr of to) await mailer.send(addr, o.subject, o.body); await this.store.update(`outbox/${o.id}`, { status: 'sent', attempts: o.attempts + 1 }); sent++; }
      catch { await this.store.update(`outbox/${o.id}`, { status: 'failed', attempts: o.attempts + 1 }); failed++; }
    }
    return { sent, failed };
  }
  async retryOutbox(id: string) {
    await this.need('admin');
    await this.store.update(`outbox/${id}`, { status: 'queued' });
  }

  // ───────── בקשות (סעיף 15) ─────────
  async createRequest(input: {
    kind: RequestKind; groupId?: string; topicId?: string; proposedHe?: string; proposedEn?: string; proposedKind?: string; proposedSystem?: string;
    description: string; rationale?: string; clientId?: string;
  }): Promise<RequestDoc> {
    const c = await this.need('verified');
    const id = input.clientId ?? uuid();
    const exists = await this.store.get<RequestDoc>(`requests/${id}`);
    if (exists) return exists; // חוזר־בטוח: אין שתי בקשות מלחיצה כפולה (T24)
    if (input.kind === 'new_topic' && !(input.proposedHe ?? '').trim() && !(input.proposedEn ?? '').trim()) throw new Error('נדרש שם הנושא בעברית או באנגלית.');
    if (!input.description.trim()) throw new Error('נדרש תיאור כללי.');
    if (looksLikePersonalData(`${input.description} ${input.rationale ?? ''}`)) throw new Error('נראה שהטקסט כולל מספר זיהוי או כתובת מייל. הבקשה אינה מיועדת לפרטי אדם.');
    const settings = (await this.store.get<Settings>('config/settings')) ?? defaultSettings(new Date(this.now()));
    const r: RequestDoc = stripUndefined({
      id, kind: input.kind, createdBy: c.user!.uid, createdAt: this.now(), updatedAt: this.now(), status: 'open',
      groupId: input.groupId, topicId: input.topicId, proposedHe: input.proposedHe?.trim(), proposedEn: input.proposedEn?.trim(),
      proposedKind: input.proposedKind, proposedSystem: input.proposedSystem,
      description: input.description.trim().slice(0, 2000), rationale: (input.rationale ?? '').trim().slice(0, 2000),
      dueAt: dueAtFor(this.now(), settings.responseDueDays),
    });
    const label = { new_topic: 'הצעת נושא חדש', inquiry: 'בירור כללי', exception_general: 'פנייה כללית לחריג' }[r.kind];
    await this.store.batch([{ op: 'set', path: `requests/${id}`, data: r }, ...this.notify('new_request', id, `${label}: ${r.proposedHe || r.proposedEn || r.description.slice(0, 60)}`, r.topicId)]);
    return r;
  }
  async listMyRequests(): Promise<RequestDoc[]> {
    const c = await this.need('verified');
    return (await this.store.list<RequestDoc>('requests', [['createdBy', '==', c.user!.uid]])).sort((a, b) => b.createdAt - a.createdAt);
  }
  async supplementRequest(id: string, text: string) {
    const c = await this.need('verified');
    const r = await this.store.get<RequestDoc>(`requests/${id}`);
    if (!r || r.createdBy !== c.user!.uid) throw new PermissionError();
    if (looksLikePersonalData(text)) throw new Error('נראה שהטקסט כולל מספר זיהוי או כתובת מייל.');
    await this.store.batch([
      { op: 'update', path: `requests/${id}`, data: { supplement: text.trim().slice(0, 2000), status: 'open', updatedAt: this.now() } },
      ...this.notify('request_completed', id, 'מורה השלים מידע בבקשה', r.topicId, `${id}-sup-${this.now()}`),
    ]);
  }
  async adminListRequests(): Promise<RequestDoc[]> { await this.need('admin'); return (await this.store.list<RequestDoc>('requests')).sort((a, b) => a.createdAt - b.createdAt); }
  async adminReply(id: string, reply: { decisionKind: NonNullable<RequestDoc['decisionKind']>; text: string; status: RequestDoc['status'] }) {
    const c = await this.need('admin');
    const r = await this.store.get<RequestDoc>(`requests/${id}`);
    if (!r) throw new Error('הבקשה לא נמצאה.');
    const outbox: OutboxDoc = {
      id: `o-reply-${id}-${this.now()}`, to: 'teacher', toUid: r.createdBy, subject: '[מאגר נושאים] יש עדכון בבקשתך',
      body: 'יש עדכון במצב הבקשה שלך. היכנסו לאתר, לאזור "הבקשות שלי", לצפייה. ההודעה אינה כוללת פרטי מקרה.', status: 'queued', attempts: 0, createdAt: this.now(),
    };
    await this.store.batch([
      { op: 'update', path: `requests/${id}`, data: { adminReply: reply.text.trim().slice(0, 2000), decisionKind: reply.decisionKind, status: reply.status, updatedAt: this.now() } },
      { op: 'set', path: `outbox/${outbox.id}`, data: outbox }, this.audit('reply_request', id, c.user!.uid),
    ]);
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
  /** בונה מחדש את קטלוג הציבור (מסמכים מקובצים) כדי לחסוך קריאות. טיוטות ונושאים שהוסרו אינם נכללים. */
  async publishCatalog(): Promise<{ topics: number; chunks: number }> {
    const c = await this.need('admin');
    const built = await buildCatalogOps(this.store, this.now());
    await this.store.batch([...built.ops, this.audit('publish_catalog', `${built.topics} topics`, c.user!.uid)]);
    return { topics: built.topics, chunks: built.chunks };
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

  // ───────── משתמשים והרשאות ─────────
  async adminListProfiles(): Promise<(Profile & { roleDoc: RoleDoc | null })[]> {
    await this.need('admin');
    const [ps, rs] = await Promise.all([this.store.list<Profile>('profiles'), this.store.list<RoleDoc & { id: string }>('roles')]);
    const rmap = new Map(rs.map(r => [r.id, r]));
    return ps.map(p => ({ ...p, roleDoc: rmap.get(p.uid) ?? null }));
  }
  /** קידום רק מתוך משתמשים רשומים ומאומתים, לא לפי כתובת שהוקלדה. מונע טעות הקלדה שמעניקה ניהול לזר. */
  async adminGrantRole(uid: string, role: Role, schoolId?: string) {
    const c = await this.need('admin');
    const p = await this.store.get<Profile>(`profiles/${uid}`);
    if (!p) throw new Error('המשתמש לא נמצא. הוא צריך להירשם ולאמת את כתובתו תחילה.');
    if (!p.emailVerified) throw new Error('כתובת המשתמש טרם אומתה.');
    if (role === 'coordinator' && !schoolId) throw new Error('רכז חייב להיות משויך למוסד.');
    const d: RoleDoc = stripUndefined({ role, schoolId: role === 'coordinator' ? schoolId : undefined, grantedBy: c.user!.uid, grantedAt: this.now() });
    await this.store.batch([{ op: 'set', path: `roles/${uid}`, data: d }, this.audit(`grant_${role}`, uid, c.user!.uid)]);
  }
  async adminRevokeRole(uid: string) {
    const c = await this.need('admin');
    const cur = await this.store.get<RoleDoc>(`roles/${uid}`);
    if (cur?.role === 'admin') {
      const admins = (await this.store.list<RoleDoc>('roles', [['role', '==', 'admin']]));
      if (admins.length <= 1) throw new Error('לא ניתן להסיר את המנהל האחרון.');
    }
    await this.store.batch([{ op: 'delete', path: `roles/${uid}` }, this.audit('revoke_role', uid, c.user!.uid)]);
  }

  // ───────── סיום מחזור ומחיקה (סעיף 17) ─────────
  async cycleCloseSummary(yearId: string) {
    await this.need('admin');
    const gs = await this.store.list<Group>('groups', [['yearId', '==', yearId]]);
    const byStatus: Record<string, number> = {};
    gs.forEach(g => { byStatus[g.status] = (byStatus[g.status] ?? 0) + 1; });
    return { groups: gs.length, byStatus, withNames: gs.filter(g => g.students.length > 0).length };
  }
  /**
   * סגירת מחזור: מעדכן היסטוריה לא מזהה (מוסד/שנה/נושא/מצב), מוחק את כל הקבוצות של המחזור (ושמות התלמידים שבתוכן),
   * מנתק הפניות קבוצה מבקשות, ורושם יומן מחיקות שמונע החזרה בשחזור. ניתן להרצה חוזרת בבטחה.
   */
  async closeCycle(yearId: string): Promise<{ deleted: number }> {
    const c = await this.need('admin');
    const gs = await this.store.list<Group>('groups', [['yearId', '==', yearId]]);
    const bySchool = new Map<string, Group[]>();
    gs.forEach(g => bySchool.set(g.schoolId, [...(bySchool.get(g.schoolId) ?? []), g]));
    const ops: BatchOp[] = [];
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
      ops.push({ op: 'set', path: `schoolHistory/${id}`, data: { schoolId, yearId, items, updatedAt: this.now() } });
    }
    for (const r of await this.store.list<RequestDoc>('requests')) if (r.groupId && gs.some(g => g.id === r.groupId)) ops.push({ op: 'update', path: `requests/${r.id}`, data: { groupId: '' } });
    for (const g of gs) ops.push({ op: 'delete', path: `groups/${g.id}` });
    const years = (await this.store.get<{ years: AcademicYear[] }>('config/years'))?.years ?? defaultYears(new Date(this.now()));
    ops.push({ op: 'set', path: 'config/years', data: { years: years.map(y => (y.id === yearId ? { ...y, closed: true } : y)) } });
    ops.push({ op: 'set', path: `deletionLedger/${yearId}`, data: { yearId, deletedAt: this.now(), groupsDeleted: gs.length } });
    ops.push(this.audit('close_cycle', `${yearId} (${gs.length} groups)`, c.user!.uid));
    await this.store.batch(ops);
    return { deleted: gs.length };
  }
  /** אחרי שחזור מגיבוי: מוחק מחדש כל מה שכבר הגיע מועד מחיקתו, לפי יומן המחיקות. */
  async reapplyDeletions(): Promise<{ deleted: number }> {
    await this.need('admin');
    const ledger = await this.store.list<{ yearId: string }>('deletionLedger');
    let deleted = 0;
    const ops: BatchOp[] = [];
    for (const l of ledger) for (const g of await this.store.list<Group>('groups', [['yearId', '==', l.yearId]])) { ops.push({ op: 'delete', path: `groups/${g.id}` }); deleted++; }
    if (ops.length) await this.store.batch(ops);
    return { deleted };
  }

  // ───────── גיבוי ושחזור (סעיף 20.1) ─────────
  /** includePrivate=false (ברירת מחדל): תוכן בלבד, בלי קבוצות, תלמידים, בקשות או כתובות מייל. */
  async exportBackup(includePrivate = false): Promise<{ format: 'mat-backup-1'; createdAt: number; includesPrivate: boolean; data: Record<string, any[]> }> {
    await this.need('admin');
    const pub = ['topics', 'topicVersions', 'config', 'public', 'schools', 'schoolHistory', 'policyQuestions', 'sources', 'seedEntries', 'deletionLedger', 'suggestions'];
    const priv = ['groups', 'requests', 'memberships', 'roles', 'profiles'];
    const data: Record<string, any[]> = {};
    for (const c of includePrivate ? [...pub, ...priv] : pub) data[c] = await this.store.list(c);
    // כתובת האחראי היא פרט קשר אישי: נכללת רק בגיבוי פרטי
    if (!includePrivate) data.config = (data.config ?? []).filter((d: any) => d.id !== 'contact');
    return { format: 'mat-backup-1', createdAt: this.now(), includesPrivate: includePrivate, data };
  }
  /** שחזור: כותב את הנתונים ואז מחיל מחדש מחיקות שהגיע מועדן, לפני שהמערכת חוזרת לפעילות. */
  async restoreBackup(b: { format: string; data: Record<string, any[]> }): Promise<{ restored: number; reDeleted: number }> {
    await this.need('admin');
    if (b.format !== 'mat-backup-1') throw new Error('פורמט גיבוי לא מוכר.');
    const ops: BatchOp[] = [];
    let restored = 0;
    for (const [coll, docs] of Object.entries(b.data)) for (const d of docs) { const { id, ...rest } = d; ops.push({ op: 'set', path: `${coll}/${id}`, data: rest }); restored++; }
    await this.store.batch(ops);
    const { deleted } = await this.reapplyDeletions();
    return { restored, reDeleted: deleted };
  }
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
