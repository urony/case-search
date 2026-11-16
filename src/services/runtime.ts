import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { Api, Mode } from './api';
import { AuthService, DemoAuthService, FirebaseAuthService, NoAuthService } from './auth';
import { DEMO_ACCOUNTS, seedStore } from './demoSeed';
import { FirestoreStore } from './firestoreStore';
import { LocalStore } from './localStore';

export interface Runtime { api: Api; auth: AuthService; mode: Mode; demoAvailable: boolean; demo?: DemoAuthService; notice?: string }

const env = import.meta.env;
export const DEMO_ENABLED = !!env.DEV || env.VITE_ENABLE_DEMO === '1';
const DEMO_FLAG = 'mat-use-demo';
const DEMO_DB = 'mat-demo-db-v1';

function firebaseConfig() {
  const apiKey = env.VITE_FIREBASE_API_KEY, projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`, appId: env.VITE_FIREBASE_APP_ID };
}

export function wantsDemo(): boolean {
  if (!DEMO_ENABLED) return false;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '0') { localStorage.removeItem(DEMO_FLAG); return false; }
    if (q.get('demo') === '1') localStorage.setItem(DEMO_FLAG, '1');
    return localStorage.getItem(DEMO_FLAG) === '1';
  } catch { return false; }
}
export function setDemo(on: boolean) {
  try { if (on) localStorage.setItem(DEMO_FLAG, '1'); else localStorage.removeItem(DEMO_FLAG); } catch { /* ignore */ }
  location.reload();
}
export function resetDemoData() {
  try { localStorage.removeItem(DEMO_DB); localStorage.removeItem('mat-demo-session'); } catch { /* ignore */ }
  location.reload();
}

/**
 * בחירת מצב הפעלה:
 *  - service: Firebase מוגדר (משתני VITE_FIREBASE_*): שירות אמיתי.
 *  - demo: מצב הדגמה מקומי (נתונים מלאכותיים בדפדפן בלבד), כשהופעל במפורש ומותר.
 *  - bundled: אין שירות: קריאה בלבד מתוכן מובנה, ללא כניסה וללא שמירה.
 */
export async function createRuntime(): Promise<Runtime> {
  const cfg = firebaseConfig();
  if (cfg && !wantsDemo()) {
    const app = initializeApp(cfg);
    const db = initializeFirestore(app, { localCache: memoryLocalCache() }); // בלי IndexedDB: אין מטמון מתמשך
    const auth = new FirebaseAuthService(app);
    return { api: new Api(new FirestoreStore(db), auth, 'service'), auth, mode: 'service', demoAvailable: DEMO_ENABLED };
  }
  if (wantsDemo()) {
    const store = new LocalStore(DEMO_DB);
    const now = Date.now();
    if (store.isEmpty()) await seedStore(store, now, true);
    const auth = new DemoAuthService(DEMO_ACCOUNTS);
    return { api: new Api(store, auth, 'demo'), auth, mode: 'demo', demoAvailable: true, demo: auth };
  }
  const auth = new NoAuthService();
  return {
    api: new Api(new LocalStore(null, true), auth, 'bundled'), auth, mode: 'bundled', demoAvailable: DEMO_ENABLED,
    notice: 'שירות הנתונים אינו מוגדר. התוכן מוצג מקובץ מובנה, בקריאה בלבד. כניסה, שמירת קבוצות, הוספת מקורות והגשת בקשות אינם זמינים.',
  };
}
