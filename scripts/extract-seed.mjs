// מחלץ את נספח 114 הרשומות מקובץ המפרט אל data/seed.json (חומר מקור בלבד; לא מריץ קוד מתוכו).
import fs from 'node:fs';
const spec = fs.readFileSync(new URL('../references/spec.md', import.meta.url), 'utf8');
const marker = spec.indexOf('<!-- SEED_APPENDIX -->');
if (marker < 0) throw new Error('SEED_APPENDIX marker not found');
const m = /```json\s*\n([\s\S]*?)\n```/.exec(spec.slice(marker));
if (!m) throw new Error('json block not found');
const seed = JSON.parse(m[1]);
if (!Array.isArray(seed.entries)) throw new Error('entries missing');
const ids = new Set(seed.entries.map(e => e.seedId));
if (ids.size !== seed.entries.length) throw new Error('duplicate seedId');
fs.writeFileSync(new URL('../data/seed.json', import.meta.url), JSON.stringify(seed, null, 2) + '\n');
console.log(`seed.json: ${seed.entries.length} entries, schemaVersion ${seed.schemaVersion}`);
