import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRuntime } from './services/runtime';
import App from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="wrap" style={{ padding: 40 }} role="status">טוען…</div>);

createRuntime()
  .then(rt => root.render(<StrictMode><App rt={rt} /></StrictMode>))
  .catch(e => {
    // שגיאת אתחול (למשל הגדרת שירות שגויה): מציגים מצב אמיתי ולא מסתירים
    root.render(<div className="wrap" style={{ padding: 40 }} role="alert"><h2>לא ניתן להפעיל את האתר</h2><p>{String(e?.message ?? e)}</p><p>בדקו את הגדרות החיבור בקובץ <code>.env.local</code>.</p></div>);
  });
