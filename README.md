# בדיקת התאמה לנושאי עבודות גמר במערכות רפואיות

כלי למורים: חיפוש נושא, הבנת תנאיו, בדיקת התאמה של מקרה בדפדפן (בלי שמירת נתוני מטופל), מקורות לאיתור מטופלים, בקשות וניהול.
**אינו אישור פיקוח רשמי.**

```bash
npm install
npm test
npm run dev          # http://localhost:5173  (ללא הגדרות: קריאה בלבד)
                     # http://localhost:5173/?demo=1  (מצב הדגמה עם נתונים מלאכותיים)
```

- מדריך הפעלה ופרסום: [docs/SETUP-he.md](docs/SETUP-he.md)
- החלטת התשתית: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- מצב הבדיקות מול תרחישי הקבלה: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- מדריך למנהל (עדכונים, בקשות, גיבוי, שחזור, סיום מחזור): [docs/ADMIN-GUIDE-he.md](docs/ADMIN-GUIDE-he.md)
- מה נשמר ומי רואה: [docs/DATA-INVENTORY-he.md](docs/DATA-INVENTORY-he.md)
- מכסות ועלויות: [docs/QUOTA-he.md](docs/QUOTA-he.md)
- הצעת גיבוי אוטומטי: [docs/AUTO-BACKUP-PROPOSAL-he.md](docs/AUTO-BACKUP-PROPOSAL-he.md)
- מצב הפרויקט: [PROJECT_STATUS.md](PROJECT_STATUS.md)
- המפרט: [references/spec.md](references/spec.md)

מבנה: `src/engine` (מנוע כללים), `src/domain` (חיפוש, ייבוא, עזרים), `src/services` (נתונים, הרשאות, כניסה), `src/ui` (מסכים), `data` (מיפוי 114 הרשומות ומילונים), `firestore.rules`, `scripts` (מנהל ראשון, גיבוי אוטומטי עתידי).
