// נרמול טקסט לחיפוש: עברית, אנגלית, קיצורים וכתיב חלופי (סעיף 7.1).
// מנרמלים רווחים, נקודות, גרשיים וסימני ציטוט, אך אין מאחדים אבחנות רק כי מילותיהן דומות.

const NIQQUD = /[֑-ׇ]/g;
const QUOTES = /[׳'’‘`´״"“”]/g;
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

export function normalize(input: string): string {
  let s = input.normalize('NFKC').replace(NIQQUD, '').toLowerCase();
  s = s.replace(QUOTES, '');
  // C.O.P.D. -> copd (נקודות בין אותיות)
  s = s.replace(/(?<=\p{L})\.(?=\p{L})/gu, '').replace(/\.(?=\s|$)/g, '');
  s = s.replace(/[־\-–—_/\\,;:()[\]{}]/g, ' ');
  s = s.replace(/[ךםןףץ]/g, c => FINALS[c]);
  return s.replace(/\s+/g, ' ').trim();
}

export function tokens(input: string): string[] {
  const n = normalize(input);
  return n ? n.split(' ') : [];
}

/** מרחק לוונשטיין עם חיתוך מוקדם */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
    cur = [];
  }
  return prev[b.length];
}
