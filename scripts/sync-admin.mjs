/* Copies the prices the owner set in the admin (Prices and Designs tabs) into src/data/designs.json, so the prerendered pages, the
   search-engine data and the first paint show exactly what checkout charges (instead of the old built-in numbers, then a jump).
   Runs first in `npm run build`. It only touches prices; if the shop's server can't be reached (offline build, first deploy) the
   file is left as it is and the build carries on. The server keeps charging its own list either way. */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(await readFile(join(root, 'src/data/site.json'), 'utf8'));
const base = String(site.apiUrl || '').trim().replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.log('sync-admin: no apiUrl, skipped'); process.exit(0); }

const get = async (p) => {
  const r = await fetch(base + p, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(p + ' ' + r.status);
  return r.json();
};

let prices, designs;
try { [prices, designs] = await Promise.all([get('/api/prices'), get('/api/designs')]); }
catch (e) { console.log('sync-admin: server not reachable, prices left as they are (' + e.message + ')'); process.exit(0); }

const file = join(root, 'src/data/designs.json');
let text = await readFile(file, 'utf8');
const before = text;
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

const door = num(prices.door, 1, 999), win = num(prices.window, 1, 999), acc = num(prices.accent, 1, 999), badge = num(prices.badge, 1, 999);
if (door != null && win != null && acc != null) text = text.replace(/"pieces":\s*\{[^}]*\}/, `"pieces": {"door": ${door}, "window": ${win}, "accent": ${acc}}`);
if (badge != null) text = text.replace(/"extras":\s*\{\s*"badge":\s*[\d.]+\s*\}/, `"extras": {"badge": ${badge}}`);
const fee = num(prices.shipping, 0, 999), free = num(prices.freeFrom, 0, 9999);
if (fee != null && free != null) text = text.replace(/"shipping":\s*\{[^}]*\}/, `"shipping": {"fee": ${fee}, "freeFrom": ${free}}`);

for (const d of Array.isArray(designs.designs) ? designs.designs : []) {
  const price = num(d && d.price, 1, 999);
  if (price == null || d.custom || typeof d.id !== 'string') continue;
  // one design per line in designs.json: only a design that already exists there (the owner's added designs come from the server)
  text = text.replace(new RegExp(`("id":\\s*"${d.id.replace(/[^\w-]/g, '')}"[^\\n]*?"price":\\s*)[\\d.]+`), `$1${price}`);
}

if (text !== before) { await writeFile(file, text); console.log('sync-admin: designs.json updated from the admin prices'); }
else console.log('sync-admin: prices already match the admin');
