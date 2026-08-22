/**
 * Second pass: which install hook, not merely whether there is one.
 *
 *   node hooks-pass.mjs --in npm-all.ndjson        after the census finishes
 *   node hooks-pass.mjs --in npm-all.ndjson --rps 12
 *
 * Why this exists. The census stores install hooks as a single bit, set by any
 * of preinstall, install, postinstall or prepare. Three of those run when a
 * person types `npm install`. The fourth does not: `prepare` runs for whoever
 * builds the package from source, not for the consumer unpacking a tarball out
 * of the registry. So the headline "6.3% of npm executes code at install time"
 * counts packages that execute nothing on the machine doing the installing, and
 * we cannot say by how much it is wrong, because the bit threw the detail away.
 *
 * Found 2026-08-20, after the number had already been promised in public.
 *
 * The census is deliberately left alone. It was 25% through and healthy, and
 * changing the record shape mid-run produces one file with two incompatible
 * halves, which is a worse problem than a second pass. This pass re-fetches
 * only the packages the census already flagged, roughly 271k of 4.3M, about
 * three hours at 25 requests per second.
 *
 * Same operational contract as the other crawlers: append-only NDJSON that is
 * its own resume state, a PAUSE file, a disk floor, a token bucket, and a stop
 * if the registry keeps refusing.
 */
import { appendFileSync, createReadStream, existsSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const IN = join(HERE, arg('--in', 'npm-all.ndjson'));
const OUT = join(HERE, 'npm-hooks.ndjson');
const STATE = join(HERE, 'state-hooks.json');
const STATUS = join(HERE, 'STATUS-hooks.md');
const PAUSE = join(HERE, 'PAUSE-HOOKS');
const RPS = Number(arg('--rps', 25));
const MIN_FREE_GB = 25;

/** The three that run for the person installing, and the one that does not. */
const CONSUMER_HOOKS = ['preinstall', 'install', 'postinstall'];
const BUILDER_HOOKS = ['prepare'];

const freeGb = () => { const s = statfsSync(HERE); return (s.bavail * s.bsize) / 1e9; };

if (!existsSync(IN)) {
  console.error(`no input at ${IN}. Run the census first, or pass --in <file>.`);
  process.exit(1);
}

console.error('reading the census for flagged packages…');
const targets = [];
{
  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    // Cheap prefilter: only parse rows that could carry a set bit at all.
    if (!line.includes('"s":1')) continue;
    try {
      const rec = JSON.parse(line);
      if (Object.values(rec.v ?? {}).some((v) => v.s === 1)) targets.push(rec.n);
    } catch {
      /* a truncated final line from a killed run */
    }
  }
}

const done = new Set();
if (existsSync(OUT)) {
  const rl = createInterface({ input: createReadStream(OUT), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { done.add(JSON.parse(line).n); } catch { /* partial line */ }
  }
}
const queue = targets.filter((n) => !done.has(n));
console.error(`flagged: ${targets.length}, already done: ${done.size}, left: ${queue.length}`);

const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, 'utf8'))
  : { started: new Date().toISOString(), ok: 0, missing: 0, failed: 0, throttled: 0 };
state.resumedAt = new Date().toISOString();
const saveState = () => {
  writeFileSync(STATE + '.tmp', JSON.stringify(state, null, 1));
  renameSync(STATE + '.tmp', STATE);
};

const startedMs = Date.now();
let tokens = RPS;
let lastRefill = Date.now();
let backoffUntil = 0;
let consecutiveRefusals = 0;
let stop = false;

async function takeToken() {
  for (;;) {
    const now = Date.now();
    tokens = Math.min(RPS, tokens + ((now - lastRefill) / 1000) * RPS);
    lastRefill = now;
    if (now < backoffUntil) { await new Promise((r) => setTimeout(r, backoffUntil - now)); continue; }
    if (tokens >= 1) { tokens -= 1; return; }
    await new Promise((r) => setTimeout(r, Math.max(20, 1000 / RPS)));
  }
}

/**
 * Per-version hook names, kept apart rather than collapsed to a bit.
 * `consumer` is the number that answers the public question. `builder` is
 * carried separately so the gap between the two can be reported instead of
 * hidden, which is the whole reason for this pass.
 */
function hooksOf(doc) {
  const versions = {};
  for (const [ver, meta] of Object.entries(doc.versions ?? {})) {
    const scripts = meta.scripts ?? {};
    const consumer = CONSUMER_HOOKS.filter((h) => scripts[h]);
    const builder = BUILDER_HOOKS.filter((h) => scripts[h]);
    if (consumer.length || builder.length) versions[ver] = { c: consumer, b: builder };
  }
  return { n: doc.name, t: doc.time ?? {}, v: versions };
}

async function fetchOne(name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await takeToken();
    try {
      const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
        headers: { accept: 'application/json', 'user-agent': 'dep-weight research (github.com/dimhold/dep-weight)' },
      });
      if (res.status === 404) { state.missing++; consecutiveRefusals = 0; return null; }
      if (res.status === 429 || res.status >= 500) {
        state.throttled++;
        consecutiveRefusals++;
        backoffUntil = Date.now() + Math.min(120000, 2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      consecutiveRefusals = 0;
      return hooksOf(doc);
    } catch {
      if (attempt === 4) { state.failed++; return null; }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  state.failed++;
  return null;
}

function status(note) {
  const doneNow = done.size + state.ok + state.missing;
  const pct = targets.length ? ((100 * doneNow) / targets.length).toFixed(2) : '0';
  const rate = state.ok / Math.max(1, (Date.now() - startedMs) / 1000);
  writeFileSync(STATUS, [
    '# npm install hooks, second pass — состояние', '',
    `Обновлено: ${new Date().toISOString()}`,
    `Старт: ${state.started}`, '',
    `- Готово: **${doneNow.toLocaleString('ru-RU')} из ${targets.length.toLocaleString('ru-RU')}** (${pct}%)`,
    `- В этом заходе: ok ${state.ok}, нет в реестре ${state.missing}, ошибок ${state.failed}`,
    `- Скорость: ${rate.toFixed(1)} пакетов/с (цель ${RPS})`,
    `- Притормаживаний реестром: ${state.throttled}`,
    `- Свободно на диске: ${freeGb().toFixed(1)} ГБ (порог ${MIN_FREE_GB} ГБ)`,
    `- Пауза: ${existsSync(PAUSE) ? 'ДА' : 'нет'}`, '',
    `Заметка: ${note}`, '',
    'Приостановить: `touch PAUSE-HOOKS`.',
    `Продолжить: \`rm -f PAUSE-HOOKS && nohup node hooks-pass.mjs --rps ${RPS} >> hooks.log 2>&1 &\``,
  ].join('\n') + '\n');
}

status('старт');

const CONC = Math.max(2, Math.min(16, Math.ceil(RPS / 2)));
let cursor = 0;
let sinceFlush = 0;

await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (!stop) {
      const i = cursor++;
      if (i >= queue.length) return;
      if (existsSync(PAUSE)) { stop = true; status('ПАУЗА по файлу PAUSE-HOOKS'); return; }
      if (freeGb() < MIN_FREE_GB) { stop = true; status(`ОСТАНОВЛЕН: свободно ${freeGb().toFixed(1)} ГБ`); return; }
      if (consecutiveRefusals > 40) { stop = true; status('ОСТАНОВЛЕН: реестр отказывает подряд, не давим'); return; }

      const rec = await fetchOne(queue[i]);
      if (rec) { appendFileSync(OUT, JSON.stringify(rec) + '\n'); state.ok++; }
      if (++sinceFlush >= 200) { sinceFlush = 0; saveState(); status(`последний: ${queue[i]}`); }
    }
  }),
);

saveState();
status(stop ? 'остановлен' : 'ГОТОВО: очередь пройдена');
console.error(`done: ok=${state.ok} missing=${state.missing} failed=${state.failed} throttled=${state.throttled}`);
