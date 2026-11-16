// שכבת אחסון מופשטת: מסמכים בקבוצות שטוחות. ההרשאות האמיתיות נאכפות בצד השירות (firestore.rules);
// מימוש מקומי משמש להדגמה ולבדיקות בלבד.

export type FilterOp = '==' | '!=' | 'in';
export type Filter = [field: string, op: FilterOp, value: unknown];

export interface Tx {
  get<T>(path: string): Promise<T | null>;
  set(path: string, data: object): void;
  delete(path: string): void;
}

export type BatchOp = { op: 'set'; path: string; data: object } | { op: 'update'; path: string; data: object } | { op: 'delete'; path: string };

export interface Store {
  readonly kind: 'firestore' | 'local' | 'readonly';
  get<T>(path: string): Promise<T | null>;
  list<T>(collection: string, where?: Filter[]): Promise<T[]>;
  set(path: string, data: object): Promise<void>;
  update(path: string, patch: object): Promise<void>;
  delete(path: string): Promise<void>;
  batch(ops: BatchOp[]): Promise<void>;
  transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export class ConflictError extends Error {
  constructor(message = 'הרשומה שונתה בידי משתמש אחר. יש לרענן ולנסות שוב.') { super(message); this.name = 'ConflictError'; }
}
export class PermissionError extends Error {
  constructor(message = 'אין הרשאה לפעולה זו.') { super(message); this.name = 'PermissionError'; }
}
export class ServiceUnavailableError extends Error {
  constructor(message = 'שירות הנתונים אינו מוגדר או אינו זמין.') { super(message); this.name = 'ServiceUnavailableError'; }
}

export function splitPath(path: string): [string, string] {
  const i = path.indexOf('/');
  if (i < 0) throw new Error(`bad path: ${path}`);
  return [path.slice(0, i), path.slice(i + 1)];
}
