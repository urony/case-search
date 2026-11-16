// אתחול משותף ל-firebase-admin. דורש מפתח שירות (service account) שנשמר מחוץ לפרויקט ולעולם לא נכנס ל-git.
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';

export function init() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('הגדירו FIREBASE_PROJECT_ID');
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    : keyPath && fs.existsSync(keyPath) ? cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) : applicationDefault();
  initializeApp({ projectId, credential });
  return { db: getFirestore(), auth: getAuth() };
}
