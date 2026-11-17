import { useEffect } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DemoAuthService } from '../services/auth';
import { DEMO_ACCOUNTS } from '../services/demoSeed';
import { resetDemoData, setDemo } from '../services/runtime';
import { CatalogProvider, RuntimeCtx, SessionProvider, useRT, useSession } from './ctx';
import type { Runtime } from '../services/runtime';
import Admin from './pages/Admin';
import Coordinator from './pages/Coordinator';
import Home from './pages/Home';
import { About, HistoryPage, NewThisYear } from './pages/Misc';
import { ApprovalBanner, Groups, Login, MyRequests, Profile, RequestForm, VerifyBanner } from './pages/Account';
import { AddSourceForm } from './pages/Sources';
import TopicPage from './pages/TopicPage';
import { Notice } from './components';
import { V1 } from '../features';
import { PublicAbout, PublicHome, PublicTopic, WhatsNew } from './v1/PublicPages';

function Banners() {
  const { mode, notice, demo, demoAvailable } = useRT();
  const { ctx, refresh } = useSession();
  if (mode === 'demo') {
    return (
      <div className="banner demo" role="region" aria-label="מצב הדגמה">
        <div className="wrap">
          <b>מצב הדגמה.</b> נתונים מלאכותיים הנשמרים בדפדפן זה בלבד, ללא שיתוף וללא דוא״ל אמיתי. אינו נתוני מוסדות אמיתיים.
          <label className="row">{V1 ? 'מצב:' : 'מעבר לתפקיד:'}
            <select aria-label="מעבר בין חשבונות הדגמה" style={{ inlineSize: 'auto' }} value={ctx.user?.uid ?? ''} onChange={async e => { const d = demo as DemoAuthService; if (e.target.value) await d.switchTo(e.target.value); else await d.signOut(); await refresh(); }}>
              <option value="">{V1 ? 'אורח (תלמיד או מורה)' : 'אורח'}</option>{DEMO_ACCOUNTS.filter(a => !V1 || a.uid === 'demo-admin').map(a => <option key={a.uid} value={a.uid}>{V1 ? 'מנהל (הדגמה)' : a.displayName}</option>)}</select></label>
          <button className="btn small secondary" onClick={() => { if (confirm('לאפס את נתוני ההדגמה?')) resetDemoData(); }}>איפוס נתוני הדגמה</button>
          <button className="btn small secondary" onClick={() => setDemo(false)}>יציאה ממצב הדגמה</button>
        </div>
      </div>
    );
  }
  if (mode === 'bundled') {
    return (
      <div className="banner info" role="region" aria-label="מצב חיבור">
        <div className="wrap">{notice} {demoAvailable && <button className="btn small secondary" onClick={() => setDemo(true)}>הפעלת מצב הדגמה (נתונים מלאכותיים)</button>}</div>
      </div>
    );
  }
  return null;
}

function Header() {
  const { auth, mode } = useRT();
  const { ctx, badges, refreshBadges } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => { refreshBadges(); }, [loc.pathname, refreshBadges]); // לכל היותר פעם בדקה
  return (
    <header className="site">
      <div className="wrap top">
        <h1><Link to="/">בדיקת התאמה לנושאי עבודות גמר במערכות רפואיות</Link></h1>
        <nav className="main" aria-label="ניווט ראשי">
          <NavLink to="/" end>חיפוש</NavLink>
          <NavLink to="/new-this-year">{V1 ? 'מה נוסף השנה' : 'חדשים השנה'}</NavLink>
          {!V1 && <NavLink to="/history">היסטוריית מוסד</NavLink>}
          <NavLink to="/about">{V1 ? 'על הכלי' : 'הסבר'}</NavLink>
          {!V1 && ctx.approved && <NavLink to="/groups">הקבוצות שלי</NavLink>}
          {!V1 && ctx.approved && <NavLink to="/requests">הבקשות שלי{badges.unseenReplies > 0 && <span className="count" aria-label={`${badges.unseenReplies} עדכונים חדשים`}>{badges.unseenReplies}</span>}</NavLink>}
          {!V1 && ctx.role === 'coordinator' && <NavLink to="/coordinator">רכז</NavLink>}
          {ctx.role === 'admin' && <NavLink to="/admin">ניהול{(badges.admin?.total ?? 0) > 0 && <span className="count" aria-label={`${badges.admin!.total} פריטים הממתינים לטיפול`}>{badges.admin!.total}</span>}</NavLink>}
        </nav>
        <div className="userbox">
          {ctx.user ? (<>{V1 ? <span>{ctx.user.displayName || ctx.user.email}</span> : <Link to="/profile">{ctx.user.displayName || ctx.user.email}</Link>}<button className="linkbtn" onClick={async () => { await auth.signOut(); nav('/'); }}>יציאה</button></>)
            : mode !== 'bundled' && !V1 && <Link className="btn small" to="/login">כניסה או הרשמה</Link>}
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const { demoAvailable, mode } = useRT();
  return (
    <>
      <a className="skip" href="#main">דילוג לתוכן</a>
      <Banners />
      <Header />
      <main id="main" tabIndex={-1}>
        <div className="wrap">
          <VerifyBanner />
          {!V1 && <ApprovalBanner />}
          <Routes>
            <Route path="/" element={V1 ? <PublicHome /> : <Home />} />
            <Route path="/topic/:id" element={V1 ? <PublicTopic /> : <TopicPage />} />
            <Route path="/new-this-year" element={V1 ? <WhatsNew /> : <NewThisYear />} />
            <Route path="/about" element={V1 ? <PublicAbout /> : <About />} />
            <Route path="/login" element={<Login />} />
            {!V1 && <>
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/requests" element={<MyRequests />} />
              <Route path="/requests/new-topic" element={<RequestForm kind="new_topic" />} />
              <Route path="/requests/inquiry" element={<RequestForm kind="inquiry" />} />
              <Route path="/sources/add" element={<AddSourcePage />} />
              <Route path="/coordinator" element={<Coordinator />} />
            </>}
            <Route path="/admin/*" element={<Admin />} />
            <Route path="*" element={<div className="card empty"><p>הדף לא נמצא.</p><Link to="/">לדף הראשי</Link></div>} />
          </Routes>
        </div>
      </main>
      <footer className="site">
        <div className="wrap">
          {V1
            ? <>המידע מתייחס להתאמת הנושא ואינו אישור פיקוח סופי או אישור של מטופל מסוים. בחירת מטופלים והגשת הנושא כפופות להנחיות ולאישור הפיקוח. · <Link to="/login?next=/admin">כניסת מנהלים</Link></>
            : <>הכלי בודק התאמה לפי המאגר ואינו אישור פיקוח רשמי. התוכן הרפואי נקבע בידי הנהלת המאגר. בדיקת מקרה מתבצעת בדפדפן בלבד ואינה נשמרת.</>}
          {demoAvailable && mode !== 'demo' && <> · <button className="linkbtn small" onClick={() => setDemo(true)}>מצב הדגמה</button></>}
        </div>
      </footer>
    </>
  );
}

function AddSourcePage() {
  const { ctx } = useSession();
  const nav = useNavigate();
  if (!ctx.approved) return <Notice kind="warn">הוספת מקור זמינה למורים מאושרים בלבד. יש <Link to="/login?next=/sources/add">להיכנס</Link>. מומלץ להוסיף מקור מכרטיס הנושא.</Notice>;
  return <AddSourceForm topicId="" onDone={() => nav('/')} />;
}

export default function App({ rt }: { rt: Runtime }) {
  return (
    <RuntimeCtx.Provider value={rt}>
      <HashRouter>
        <SessionProvider>
          <CatalogProvider>
            <Shell />
          </CatalogProvider>
        </SessionProvider>
      </HashRouter>
    </RuntimeCtx.Provider>
  );
}
