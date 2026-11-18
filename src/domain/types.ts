import type { Coverage, Policy, RuleSet } from '../engine/types';
export type { Policy } from '../engine/types';

export type PublishStatus = 'draft' | 'published' | 'unpublished' | 'merged';
export type Kind = 'unclassified' | 'disease' | 'condition' | 'event' | 'injury' | 'syndrome' | 'category' | 'redirect';
export type NoteType = 'condition' | 'difficulty' | 'attention' | 'clarification';
export type NoteSeverity = 'info' | 'warning' | 'high';

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  text: string;
  severity: NoteSeverity;
  active: boolean;
  showInResults: boolean;
}

export interface Relation {
  type: 'excludes' | 'conflicts_with' | 'same_family' | 'related' | 'broader_than' | 'redirects_to' | 'allowed_together';
  targetId: string;
  note?: string;
}

/** 0 = ללא סימון, 1 = מאתגר, 2 = מאתגר מאוד (סעיף 9.2). אינו תנאי פסילה. */
export type Difficulty = 0 | 1 | 2;

export interface Topic {
  id: string;
  seedIds: string[];
  he: string;
  en: string;
  aliases: string[];
  kind: Kind;
  kindSuggestion?: Kind;
  systems: string[]; // מזהי מערכות; הראשונה עיקרית
  systemsRaw: string[]; // המינוח המקורי מהמקור (נשמר)
  systemsNeedReview: boolean;
  tags: string[];
  suggestedTags: string[]; // הצעות ממתינות לאישור מנהל (R05)
  policy: Policy;
  publish: PublishStatus;
  ageMin: number | null;
  ageMax: number | null;
  difficulty: Difficulty;
  notes: Note[];
  sourceCondition: string;
  reviewNote: string;
  sourcePages: string;
  mappingStatusRaw: string;
  familyId: string;
  relations: Relation[];
  rules: RuleSet;
  coverage: Coverage;
  generalThreshold: boolean;
  addedYear: string | null; // מזהה שנת לימודים שבה נוסף כחדש
  sourceMapped: boolean; // מיפוי ראשוני מהמקורות, טרם נבדק סופית בידי מנהל
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export interface SystemDef { id: string; label: string }
export interface TagDef { id: string; label: string; description?: string }

export type SourceKind = 'association' | 'website' | 'facebook' | 'social' | 'professional' | 'phone' | 'free' | 'clinic' | 'community';
export interface SourceLink { label: string; url: string }
export interface RecruitmentSource {
  id: string;
  topicId: string;
  title: string;
  kind: SourceKind;
  text: string;
  url: string;
  /** קישורים נוספים עם תווית (אתר, מרפאה, קהילה...). לא חובה */
  links?: SourceLink[];
  phone: string;
  region: string;
  population: string;
  createdBy: string;
  createdAt: number;
  visible: boolean;
  editedBy?: string;
  editedAt?: number;
  /** false עד שמנהל סימן שבדק את המקור (המקור מתפרסם מיד, ללא תלות בבדיקה) */
  reviewed?: boolean;
  reviewedBy?: string;
  reviewedAt?: number;
  clientId?: string;
}

export interface SourceReport {
  id: string;
  sourceId: string;
  reason: string;
  createdBy: string;
  createdAt: number;
  handled: boolean;
  handledBy?: string;
  handledAt?: number;
}

export type Role = 'teacher' | 'coordinator' | 'admin';
export interface RoleDoc { role: Role; schoolId?: string; grantedBy: string; grantedAt: number }

export interface Profile { uid: string; displayName: string; email: string; emailVerified: boolean; createdAt: number }
export interface School { id: string; name: string; city: string; active: boolean }
/** מורה שהפיקוח אישר מראש. מזהה המסמך הוא כתובת המייל באותיות קטנות. הגישה נבדקת בכל בקשה: ביטול (active=false) חל מיד. */
export interface AllowedTeacher {
  id: string; email: string; name: string; schoolIds: string[]; active: boolean; note?: string;
  addedBy: string; addedAt: number; revokedAt?: number; revokedBy?: string; revokedReason?: string;
}

export type GroupStatus = 'draft' | 'self_check' | 'case_check_done' | 'needs_clarification' | 'submitted_external' | 'done' | 'cancelled';
export interface Group {
  id: string;
  ownerUid: string;
  schoolId: string;
  yearId: string;
  topicId: string | null;
  studentCount: 1 | 2 | 3;
  /** שם פרטי או כינוי, רשות. נשמרים במסמך הקבוצה בלבד כדי שמחיקת המסמך תמחק הכול. */
  students: { label: string }[];
  status: GroupStatus;
  casesDeclared: number; // מספר בדיקות שהמורה מדווח שהושלמו, ללא פרטי מקרה
  ruleVersionAtCheck: number | null;
  createdAt: number;
  updatedAt: number;
}

export type RequestKind = 'new_topic' | 'inquiry' | 'exception_general';
export type RequestStatus = 'open' | 'in_progress' | 'waiting_teacher' | 'answered' | 'closed';
export interface RequestDoc {
  id: string;
  kind: RequestKind;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: RequestStatus;
  groupId?: string;
  topicId?: string;
  proposedHe?: string;
  proposedEn?: string;
  proposedKind?: string;
  proposedSystem?: string;
  description: string;
  rationale: string;
  supplement?: string;
  adminReply?: string;
  decisionKind?: 'supplement' | 'general_approval' | 'case_specific' | 'rejection';
  dueAt: number;
  /** מועד המענה האחרון של המנהל, ומועד שבו המורה ראה אותו (חיווי "חדש" בלי דוא"ל) */
  repliedAt?: number;
  teacherSeenAt?: number;
  createdByEmail?: string;
  createdByName?: string;
  clientId?: string;
}

export interface SchoolYearHistory {
  id: string; // `${schoolId}_${yearId}`
  schoolId: string;
  yearId: string;
  /** groupId אקראי ואינו מזהה אדם. state: declared = נבחר במחזור הפעיל, done/cancelled/approved_not_done = לאחר סגירת מחזור */
  items: { groupId: string; topicId: string; familyId: string; topicHe: string; state: 'done' | 'cancelled' | 'approved_not_done' | 'declared' }[];
  updatedAt: number;
}

export interface PolicyQuestion {
  id: string;
  topic: string;
  source: string;
  question: string;
  owner: string;
  state: 'open' | 'answered';
  answer: string;
  answeredBy?: string;
  answeredAt?: number;
}

export interface AcademicYear { id: string; label: string; start: string; end: string; cycleEnd: string | null; closed: boolean }

export interface Settings {
  officialFormUrl: string;
  responsibleEmail: string;
  responsibleName: string;
  responseDueDays: number;
  submissionNote: string;
  currentYearId: string;
}

/** פריט ב"מה נוסף השנה": תוספת או עדכון מהותי שמנהל בחר לפרסם. אינו נוצר אוטומטית מייבוא או משינוי קטן. */
export interface NewItem {
  id: string;
  yearId: string;
  topicId: string | null;
  title: string;
  text: string;
  publishedAt: number;
  visible: boolean;
  /** מזהה המנהל שיצר. אינו נכלל בעותק הציבורי */
  createdBy?: string;
  updatedAt: number;
}
/** הצעה מהציבור (בלי כניסה): מקור לאיתור מטופלים או המלצה לנושא. נקראת רק בידי מנהל; מתפרסמת רק אחרי אישורו. */
export interface PublicSuggestion {
  id: string; topicId: string; title: string; text: string; url: string; contact: string;
  status: 'open' | 'approved' | 'rejected'; createdAt: number; handledBy?: string; handledAt?: number;
}
/** הצעה לנושא חדש לבדיקה (מורה או תלמיד, בלי כניסה). מגיעה למנהל בלבד */
export interface TopicProposal {
  id: string; name: string; details: string; who: string; role: 'teacher' | 'student' | 'other'; school: string; contact: string;
  status: 'open' | 'added' | 'rejected'; createdAt: number; handledBy?: string; handledAt?: number;
}
/** מקור איתור כפי שהוא מופיע בעותק הציבורי: בלי מזהי משתמש, בלי מצב בדיקה פנימי */
export interface PublicSource {
  id: string; topicId: string; title: string; kind: SourceKind; text: string; url: string; links?: SourceLink[]; phone: string; region: string; population: string; createdAt: number;
}
/** המסמך הראשי של העותק הציבורי: קריאה אחת בכל ביקור מספיקה כדי לדעת אם העותק המקומי עדכני */
export interface CatalogMeta {
  chunks: number; sourceChunks?: number; generatedAt: number; sourceCounts?: Record<string, number>;
  general?: RuleSet; vocab?: { systems: SystemDef[]; tags: TagDef[] }; settings?: Settings; years?: AcademicYear[]; newItems?: NewItem[];
}

export interface AuditEvent { id: string; at: number; actor: string; action: string; ref: string; scope: string }

export interface Catalog {
  topics: Topic[];
  generalRules: RuleSet;
  systems: SystemDef[];
  tags: TagDef[];
  settings: Settings;
  years: AcademicYear[];
  generatedAt: number;
  /** מספר מקורות לכל נושא נכון לפרסום הקטלוג האחרון (חוסך קריאה לכל מקור בכל ביקור) */
  sourceCounts?: Record<string, number>;
  /** מקורות האיתור הגלויים לפי נושא, מהעותק הציבורי (ללא קריאה נפרדת לכל נושא) */
  sources?: Record<string, PublicSource[]>;
  newItems?: NewItem[];
  /** true: לא ניתן היה לרענן, מוצג עותק שמור מביקור קודם (generatedAt הוא מועד העדכון של אותו עותק) */
  stale?: boolean;
  origin: 'bundled' | 'service' | 'demo';
}
