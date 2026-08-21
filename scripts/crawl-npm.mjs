/**
 * Pull package metadata from the npm registry, either as a random sample or as
 * the full census, and keep only what the study needs.
 *
 *   node crawl-npm.mjs --sample 100000     draw a uniform random sample
 *   node crawl-npm.mjs --all               walk every name in registry-names.txt
 *   node crawl-npm.mjs --all --rps 12      the same, at a gentler request rate
 *
 * Why slim: an average packument is 66 KB and we need four things out of it, so
 * writing the raw document would cost 291 GB for 33 GB of signal. What is kept
 * per version is dependencies, publish-time install hooks, the account that
 * published it, and the maintainer count.
 *
 * Being a good guest matters more than finishing early here. The registry is a
 * public service and this is a long run, so the crawler holds a fixed request
 * rate rather than as-fast-as-possible, backs off on 429 and 5xx, and stops
 * entirely if the registry keeps refusing.
 *
 * Resumable in the literal sense: output is append-only NDJSON and the set of
 * names already written is read back on start, so a kill costs nothing. Same
 * operational contract as the other scanners: PAUSE file, disk floor, STATUS.md.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, statfsSync, renameSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES = join(HERE, "registry-names.txt");

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MODE = argv.includes("--all") ? "all" : "sample";
const SAMPLE = Number(arg("--sample", 100000));
const RPS = Number(arg("--rps", MODE === "all" ? 12 : 30));
const SEED = Number(arg("--seed", 20260819));
const MIN_FREE_GB = 25;

const tag = MODE === "all" ? "all" : `sample-${SAMPLE}`;
const OUT = join(HERE, `npm-${tag}.ndjson`);
const STATUS = join(HERE, `STATUS-crawl-${tag}.md`);
const STATE = join(HERE, `state-crawl-${tag}.json`);
const PAUSE = join(HERE, "PAUSE-CRAWL");

const freeGb = () => { const s = statfsSync(HERE); return (s.bavail * s.bsize) / 1e9; };

/* A seeded generator, so "which packages were sampled" is reproducible from the
   seed alone rather than from a file someone has to trust. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.error("reading name list…");
const names = readFileSync(NAMES, "utf8").split("\n").filter(Boolean);

let targets;
if (MODE === "all") {
  targets = names;
} else {
  // Sample without replacement: partial Fisher-Yates over an index array, which
  // costs one pass instead of rejection-sampling a set of 100k out of 4.3M.
  const rand = mulberry32(SEED);
  const idx = new Uint32Array(names.length);
  for (let i = 0; i < names.length; i++) idx[i] = i;
  const n = Math.min(SAMPLE, names.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (names.length - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  targets = Array.from(idx.slice(0, n), (i) => names[i]);
}

/* Names already written, read back from the output itself. The file is the state. */
const done = new Set();
if (existsSync(OUT)) {
  console.error("reading what is already done…");
  const rl = createInterface({ input: createReadStream(OUT), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const i = line.indexOf('","');
    if (line.startsWith('{"n":"') && i > 0) done.add(line.slice(6, i));
    else { try { done.add(JSON.parse(line).n); } catch {} }
  }
}
const queue = targets.filter((n) => !done.has(n));
console.error(`${MODE}: ${targets.length} целей, уже сделано ${done.size}, осталось ${queue.length}`);

const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : { started: new Date().toISOString(), ok: 0, missing: 0, failed: 0, bytes: 0, throttled: 0 };
state.resumedAt = new Date().toISOString();

const saveState = () => { writeFileSync(STATE + ".tmp", JSON.stringify(state, null, 1)); renameSync(STATE + ".tmp", STATE); };

function status(note) {
  const doneNow = done.size + state.ok + state.missing;
  const pct = ((100 * doneNow) / targets.length).toFixed(2);
  const rate = state.ok / Math.max(1, (Date.now() - startedMs) / 1000);
  const left = queue.length - (state.ok + state.missing + state.failed);
  writeFileSync(STATUS, [
    `# npm crawl (${MODE}${MODE === "sample" ? `, seed ${SEED}` : ""}) — состояние`, "",
    `Обновлено: ${new Date().toISOString()}`,
    `Старт: ${state.started}`, "",
    `- Готово: **${doneNow.toLocaleString("ru-RU")} из ${targets.length.toLocaleString("ru-RU")}** (${pct}%)`,
    `- В этом заходе: ok ${state.ok}, нет в реестре ${state.missing}, ошибок ${state.failed}`,
    `- Осталось в очереди: ${Math.max(0, left).toLocaleString("ru-RU")}`,
    `- Скорость: ${rate.toFixed(1)} пакетов/с (цель ${RPS})`,
    `- Притормаживаний реестром (429/5xx): ${state.throttled}`,
    `- Записано: ${(state.bytes / 1e9).toFixed(2)} ГБ`,
    `- Свободно на диске: ${freeGb().toFixed(1)} ГБ (порог ${MIN_FREE_GB} ГБ)`,
    `- Пауза: ${existsSync(PAUSE) ? "ДА" : "нет"}`, "",
    `Заметка: ${note}`, "",
    "Приостановить: `touch PAUSE-CRAWL`.",
    `Продолжить: \`rm -f PAUSE-CRAWL && nohup node crawl-npm.mjs ${MODE === "all" ? "--all" : `--sample ${SAMPLE}`} --rps ${RPS} >> crawl-${tag}.log 2>&1 &\``,
  ].join("\n") + "\n");
}

/** Keep the four fields the study reads, drop the other 90% of the document. */
function slim(doc) {
  const v = {};
  for (const [ver, m] of Object.entries(doc.versions ?? {})) {
    v[ver] = {
      d: m.dependencies ?? {},
      s: ["preinstall", "install", "postinstall", "prepare"].some((h) => m.scripts?.[h]) ? 1 : 0,
      u: m._npmUser?.name ?? null,
      m: (m.maintainers ?? []).length,
    };
  }
  return { n: doc.name, t: doc.time ?? {}, v };
}

/* A token bucket, so the rate is what we promised rather than whatever the
   network allows. Refills continuously; workers wait their turn. */
let tokens = RPS;
let lastRefill = Date.now();
let backoffUntil = 0;
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

const startedMs = Date.now();
let stop = false;
let consecutiveRefusals = 0;

async function fetchOne(name) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await takeToken();
    try {
      const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
        headers: { accept: "application/json", "user-agent": "dep-weight research (github.com/dimhold/dep-weight)" },
      });
      if (res.status === 404) { state.missing++; consecutiveRefusals = 0; return null; }
      if (res.status === 429 || res.status >= 500) {
        state.throttled++;
        consecutiveRefusals++;
        // Give the registry room: widen the pause for everyone, not just this task.
        backoffUntil = Date.now() + Math.min(120000, 2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      consecutiveRefusals = 0;
      return slim(doc);
    } catch (e) {
      if (attempt === 4) { state.failed++; return null; }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  state.failed++;
  return null;
}

status("старт");

const CONC = Math.max(2, Math.min(16, Math.ceil(RPS / 2)));
let cursor = 0;
let sinceFlush = 0;

await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (!stop) {
      const i = cursor++;
      if (i >= queue.length) return;
      if (existsSync(PAUSE)) { stop = true; status("ПАУЗА по файлу PAUSE-CRAWL"); return; }
      if (freeGb() < MIN_FREE_GB) { stop = true; status(`ОСТАНОВЛЕН: свободно ${freeGb().toFixed(1)} ГБ`); return; }
      if (consecutiveRefusals > 40) { stop = true; status("ОСТАНОВЛЕН: реестр отказывает подряд, не давим"); return; }

      const rec = await fetchOne(queue[i]);
      if (rec) {
        const line = JSON.stringify(rec) + "\n";
        appendFileSync(OUT, line);
        state.ok++;
        state.bytes += line.length;
      }
      if (++sinceFlush >= 200) { sinceFlush = 0; saveState(); status(`последний: ${queue[i]}`); }
    }
  })
);

saveState();
status(stop ? "остановлен" : "ГОТОВО: очередь пройдена");
console.error(`done: ok=${state.ok} missing=${state.missing} failed=${state.failed} throttled=${state.throttled}`);
