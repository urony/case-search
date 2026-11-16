import type { FirebaseApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut as fbSignOut, updateProfile, Auth,
} from 'firebase/auth';

export interface AuthUser { uid: string; email: string; emailVerified: boolean; displayName: string }

export interface AuthService {
  readonly kind: 'firebase' | 'demo' | 'none';
  current(): AuthUser | null;
  subscribe(cb: (u: AuthUser | null) => void): () => void;
  signUp(email: string, password: string, displayName: string): Promise<{ verificationSent: boolean; error?: string }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<{ sent: boolean; error?: string }>;
  refresh(): Promise<void>;
}

export function authErrorHe(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'כתובת המייל אינה תקינה.',
    'auth/missing-password': 'יש להזין סיסמה.',
    'auth/weak-password': 'הסיסמה חלשה מדי (לפחות 8 תווים).',
    'auth/email-already-in-use': 'כתובת זו כבר רשומה. אפשר להתחבר או לאפס סיסמה.',
    'auth/invalid-credential': 'כתובת או סיסמה שגויות.',
    'auth/user-not-found': 'כתובת או סיסמה שגויות.',
    'auth/wrong-password': 'כתובת או סיסמה שגויות.',
    'auth/too-many-requests': 'בוצעו יותר מדי ניסיונות. נסו שוב מאוחר יותר (ייתכן שהגעתם למכסת הודעות או ניסיונות).',
    'auth/network-request-failed': 'אין חיבור לשירות. בדקו את החיבור ונסו שוב.',
    'auth/quota-exceeded': 'מכסת הודעות הדוא״ל של השירות מוצתה. נסו שוב מאוחר יותר או פנו לאחראי.',
  };
  return map[code] ?? ((e as Error)?.message || 'שגיאה לא צפויה.');
}

/** כניסה אמיתית: Firebase Authentication, מייל וסיסמה עם אימות כתובת. עובד עם כתובת מכל ספק. */
export class FirebaseAuthService implements AuthService {
  readonly kind = 'firebase' as const;
  private auth: Auth;
  private cache: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(app: FirebaseApp) {
    this.auth = getAuth(app);
    onAuthStateChanged(this.auth, u => {
      this.cache = u ? { uid: u.uid, email: u.email ?? '', emailVerified: u.emailVerified, displayName: u.displayName ?? '' } : null;
      this.listeners.forEach(l => l(this.cache));
    });
  }
  current() { return this.cache; }
  subscribe(cb: (u: AuthUser | null) => void) { this.listeners.add(cb); cb(this.cache); return () => { this.listeners.delete(cb); }; }
  async signUp(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: displayName.trim() });
    try { await sendEmailVerification(cred.user); return { verificationSent: true }; }
    catch (e) { return { verificationSent: false, error: authErrorHe(e) }; } // כשל שליחה מוצג ואינו הופך את הכניסה למאומתת
  }
  async signIn(email: string, password: string) { await signInWithEmailAndPassword(this.auth, email.trim(), password); }
  async signOut() { await fbSignOut(this.auth); }
  async resetPassword(email: string) { await sendPasswordResetEmail(this.auth, email.trim()); }
  async resendVerification() {
    const u = this.auth.currentUser;
    if (!u) return { sent: false, error: 'לא מחובר.' };
    try { await sendEmailVerification(u); return { sent: true }; } catch (e) { return { sent: false, error: authErrorHe(e) }; }
  }
  async refresh() {
    const u = this.auth.currentUser;
    if (u) { await u.reload(); await u.getIdToken(true); this.cache = { uid: u.uid, email: u.email ?? '', emailVerified: u.emailVerified, displayName: u.displayName ?? '' }; this.listeners.forEach(l => l(this.cache)); }
  }
}

/** ללא שירות: אין כניסה. מוצג בבירור כמצב ללא חיבור. */
export class NoAuthService implements AuthService {
  readonly kind = 'none' as const;
  current() { return null; }
  subscribe(cb: (u: AuthUser | null) => void) { cb(null); return () => {}; }
  private fail(): never { throw new Error('שירות הכניסה אינו מוגדר. ראו את מדריך ההפעלה.'); }
  async signUp(): Promise<never> { return this.fail(); }
  async signIn(): Promise<never> { return this.fail(); }
  async signOut() {}
  async resetPassword(): Promise<never> { return this.fail(); }
  async resendVerification(): Promise<never> { return this.fail(); }
  async refresh() {}
}

export interface DemoAccount { uid: string; email: string; password: string; displayName: string; emailVerified: boolean }

/**
 * כניסה להדגמה בלבד: חשבונות מלאכותיים בדפדפן. אינה מאמתת שום דבר אמיתי ואינה תחליף להרשאות בייצור.
 * מעבר מהיר בין תפקידים משמש לבדיקות מקצה לקצה (סעיף 20.3).
 */
export class DemoAuthService implements AuthService {
  readonly kind = 'demo' as const;
  private cache: AuthUser | null = null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(readonly accounts: DemoAccount[], private storageKey = 'mat-demo-session') {
    try { const id = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null; if (id) this.setUser(id); } catch { /* ignore */ }
  }
  private setUser(uid: string | null) {
    const a = this.accounts.find(x => x.uid === uid);
    this.cache = a ? { uid: a.uid, email: a.email, emailVerified: a.emailVerified, displayName: a.displayName } : null;
    try { if (typeof localStorage !== 'undefined') { if (uid) localStorage.setItem(this.storageKey, uid); else localStorage.removeItem(this.storageKey); } } catch { /* ignore */ }
    this.listeners.forEach(l => l(this.cache));
  }
  current() { return this.cache; }
  subscribe(cb: (u: AuthUser | null) => void) { this.listeners.add(cb); cb(this.cache); return () => { this.listeners.delete(cb); }; }
  async signUp(email: string, _pw: string, displayName: string) {
    const uid = `demo-${this.accounts.length + 1}`;
    this.accounts.push({ uid, email: email.trim(), password: _pw, displayName, emailVerified: true });
    this.setUser(uid);
    return { verificationSent: false, error: 'מצב הדגמה: לא נשלח מייל אימות אמיתי.' };
  }
  async signIn(email: string, password: string) {
    const a = this.accounts.find(x => x.email.toLowerCase() === email.trim().toLowerCase() && x.password === password);
    if (!a) throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' });
    this.setUser(a.uid);
  }
  async switchTo(uid: string) { this.setUser(uid); }
  async signOut() { this.setUser(null); }
  async resetPassword() { /* הדגמה: אין מייל */ }
  async resendVerification() { return { sent: false, error: 'מצב הדגמה: אין שליחת מייל.' }; }
  async refresh() {}
}
