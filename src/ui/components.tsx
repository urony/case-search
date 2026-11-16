import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty, Policy, Topic } from '../domain/types';

export const POLICY_LABEL: Record<Policy, string> = {
  suitable: 'מתאים כנושא',
  conditional: 'מתאים בתנאים',
  not_suitable: 'לא מתאים לפי הכלל הנוכחי',
  needs_review: 'דורש בירור',
};
const POLICY_CLASS: Record<Policy, string> = { suitable: 'ok', conditional: 'warn', not_suitable: 'bad', needs_review: 'info' };
const POLICY_ICON: Record<Policy, string> = { suitable: '✓', conditional: '◐', not_suitable: '✕', needs_review: '?' };

export function PolicyBadge({ policy }: { policy: Policy }) {
  // הטקסט הוא החלק המחייב; הצבע והסמל רק תומכים (סעיף 6.1)
  return <span className={`badge ${POLICY_CLASS[policy]}`}><span aria-hidden="true">{POLICY_ICON[policy]}</span>{POLICY_LABEL[policy]}</span>;
}

export const COVERAGE_LABEL = { full: 'כיסוי כללי בדיקה: מלא', partial: 'כיסוי כללי בדיקה: חלקי', none: 'כיסוי כללי בדיקה: טרם הוגדר' } as const;
export function CoverageBadge({ topic }: { topic: Topic }) {
  const l = topic.coverage.level;
  return <span className={`badge ${l === 'full' ? 'ok' : l === 'partial' ? 'warn' : 'neutral'}`}>{COVERAGE_LABEL[l]}</span>;
}

export const DIFFICULTY_TEXT: Record<Difficulty, string> = {
  0: '',
  1: 'מאתגר למצוא מטופלים',
  2: 'מאתגר מאוד למצוא מטופלים',
};
/** משולש עם תווית נגישה: הקושי הוא באיתור בלבד ואינו תנאי פסילה (סעיף 9.2) */
export function DifficultyMark({ level, withText = true }: { level: Difficulty; withText?: boolean }) {
  if (!level) return null;
  return (
    <span className={`tri ${level === 2 ? 'high' : ''}`} title="קושי באיתור מטופלים: מידע מעשי בלבד, אינו תנאי פסילה">
      <span aria-hidden="true">{level === 2 ? '▲▲' : '▲'}</span> {withText ? DIFFICULTY_TEXT[level] : <span className="sr-only">{DIFFICULTY_TEXT[level]}</span>}
    </span>
  );
}

export function Notice({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; title?: string; children: ReactNode }) {
  return <div className={`notice ${kind}`} role={kind === 'bad' ? 'alert' : 'note'}>{title && <strong>{title}</strong>}{children}</div>;
}

export function Loading({ text = 'טוען…' }: { text?: string }) {
  return <div className="empty" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /> {text}</div>;
}
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <Notice kind="bad" title="שגיאה: ">{error} {retry && <button className="btn small secondary" onClick={retry}>נסו שוב</button>}</Notice>;
}

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="field"><span className="lbl">{label}</span>{children}{help && <span className="help">{help}</span>}</label>;
}

/** הסבר לאזהרה: בריחוף, במיקוד מקלדת ובלחיצה (סעיף 6.4) */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <span className={`tip ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}>!</button>
      <span className="tipbody" role="tooltip">{children}</span>
    </span>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    run().then(d => alive && setState({ data: d, loading: false, error: null }))
      .catch(e => alive && setState({ data: null, loading: false, error: String(e?.message ?? e) }));
    return () => { alive = false; };
  }, [run, tick]);
  return { ...state, reload: () => setTick(t => t + 1), setData: (d: T) => setState(s => ({ ...s, data: d })) };
}

export function fmtDate(ms: number): string {
  try { return new Date(ms).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return ''; }
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

/** שם אנגלי/קוד/מייל עם כיווניות מפורשת */
export function En({ children }: { children: ReactNode }) { return <bdi className="ltr">{children}</bdi>; }

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(String((e as Error)?.message ?? e)); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}
