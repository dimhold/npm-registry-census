/**
 * Count the npm registry from a crawl file.
 *
 * Input is the NDJSON written by scripts/crawl-npm.mjs: one line per package,
 * `{ n: name, t: <time map>, v: { <version>: { d, s, u, m } } }`. This script
 * makes a single streaming pass and writes an aggregate JSON file. Every number
 * that ends up in README.md comes out of this file, so the counts are raw and
 * the percentages are derived later, never the other way round.
 *
 *   node scripts/census-aggregate.mjs npm-all.ndjson --out data/census-full.json
 *   node scripts/census-aggregate.mjs slice.ndjson --out /tmp/slice.json --label slice
 *
 * Optional reservoir sampling pulls a reproducible slice out of the same pass:
 *
 *   ... --slice 5000 --slice-out slice.ndjson --slice-seed 20260821
 *
 * Definitions, spelled out because they are the whole argument:
 *
 *   newest version   the version with the latest publish date in `time`, not
 *                    `dist-tags.latest`. On abandoned packages the two agree.
 *   maintainer       an entry in the `maintainers` array of that newest
 *                    version, i.e. an account allowed to publish. Not a person.
 *   dependencies     the `dependencies` field only. No dev, peer or optional.
 *   install hook     the version declares at least one of preinstall, install,
 *                    postinstall, prepare. `prepare` does not run for someone
 *                    installing the published tarball, so this is an upper
 *                    bound on "runs code on npm install", not a measurement of
 *                    it. See README.
 */
import { createReadStream, writeFileSync, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";

const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
/* Positional argument: anything that is neither a --flag nor the value of one. */
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const INPUT = positional[0];
const OUT = flag("--out", null);
const LABEL = flag("--label", "census");
/* The reference date for "how long ago was this last published". Defaults to
   the moment the crawl finished, so the answer does not drift with the clock. */
const NOW = Date.parse(flag("--now", "2026-08-21T09:15:31Z"));
const SLICE_N = Number(flag("--slice", 0));
const SLICE_OUT = flag("--slice-out", "slice.ndjson");
const SLICE_SEED = Number(flag("--slice-seed", 20260821));

if (!INPUT) {
  console.error("usage: node census-aggregate.mjs <input.ndjson[.gz]> [--out file.json] [--label name] [--now ISO]");
  process.exit(2);
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const AGE_BUCKETS = [
  ["<1m", 30],
  ["1-6m", 182],
  ["6-12m", 365],
  ["1-2y", 730],
  ["2-5y", 1825],
  [">5y", Infinity],
];
const VER_BUCKETS = [
  ["1", 1],
  ["2", 2],
  ["3-5", 5],
  ["6-10", 10],
  ["11-25", 25],
  ["26-100", 100],
  [">100", Infinity],
];
const DEP_BUCKETS = [
  ["0", 0],
  ["1-2", 2],
  ["3-5", 5],
  ["6-10", 10],
  ["11-25", 25],
  [">25", Infinity],
];
const bucketOf = (defs, x) => defs.find(([, hi]) => x <= hi)[0];
const zero = (defs) => Object.fromEntries(defs.map(([k]) => [k, 0]));

const c = {
  lines: 0,
  parseErrors: 0,
  packages: 0,
  noVersions: 0,
  noTimeForNewest: 0,
  versionSum: 0,
  depSum: 0,
  maintSum: 0,
  installHook: 0,
  maintZero: 0,
  maintZeroPublishedByNpm: 0,
  maintOne: 0,
  maintTwoPlus: 0,
  staleTwoYears: 0,
  staleFiveYears: 0,
  age: zero(AGE_BUCKETS),
  versions: zero(VER_BUCKETS),
  deps: zero(DEP_BUCKETS),
};
const maintHist = new Map();
const publishers = new Map();

/* Reservoir sampling, algorithm R, driven by a seeded generator so the slice is
   reproducible from the seed rather than from trusting the file we hand out. */
const rand = mulberry32(SLICE_SEED);
const reservoir = SLICE_N > 0 ? [] : null;
let seen = 0;

/** Copy a string out of its parent buffer so the parent can be collected. */
const flatten = (s) => Buffer.from(s, "utf8").toString("utf8");

function handle(line) {
  c.lines++;
  let p;
  try {
    p = JSON.parse(line);
  } catch {
    c.parseErrors++;
    return;
  }
  c.packages++;

  if (reservoir) {
    seen++;
    /* Flatten before keeping: a substring of a chunk is a V8 sliced string that
       pins the whole chunk in memory, and 5000 of those pin gigabytes. */
    if (reservoir.length < SLICE_N) reservoir.push(flatten(line));
    else {
      const j = Math.floor(rand() * seen);
      if (j < SLICE_N) reservoir[j] = flatten(line);
    }
  }

  const vers = Object.keys(p.v ?? {});
  c.versionSum += vers.length;
  if (!vers.length) {
    c.noVersions++;
    return;
  }
  c.versions[bucketOf(VER_BUCKETS, vers.length)]++;

  let newest = null;
  let newestT = 0;
  for (const v of vers) {
    const t = p.t?.[v] ? Date.parse(p.t[v]) : 0;
    if (t > newestT) {
      newestT = t;
      newest = v;
    }
  }
  if (!newest) {
    c.noTimeForNewest++;
    newest = vers[vers.length - 1];
    newestT = Date.parse(p.t?.modified ?? 0) || 0;
  }
  const meta = p.v[newest];

  if (newestT) {
    const days = (NOW - newestT) / DAY;
    c.age[bucketOf(AGE_BUCKETS, days)]++;
    if (days >= 730) c.staleTwoYears++;
    if (days >= 1825) c.staleFiveYears++;
  }

  const d = Object.keys(meta.d ?? {}).length;
  c.depSum += d;
  c.deps[bucketOf(DEP_BUCKETS, d)]++;

  if (meta.s) c.installHook++;

  const m = Number(meta.m ?? 0);
  c.maintSum += m;
  maintHist.set(m, (maintHist.get(m) ?? 0) + 1);
  if (m === 0) {
    c.maintZero++;
    /* An empty maintainer list usually means the registry itself touched the
       package last: npm republishes a `0.0.1-security` version under its own
       account when a package is removed, and that version carries no
       maintainers. Counting the overlap keeps the "no maintainer" bucket from
       being read as "abandoned by a human". */
    if (meta.u === "npm") c.maintZeroPublishedByNpm++;
  } else if (m === 1) c.maintOne++;
  else c.maintTwoPlus++;

  if (meta.u) publishers.set(meta.u, (publishers.get(meta.u) ?? 0) + 1);
}

const started = Date.now();
let lastReport = started;
const raw = createReadStream(INPUT, { highWaterMark: 1 << 23 });
const stream = INPUT.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
stream.setEncoding("utf8");

let tail = "";
for await (const chunk of stream) {
  let from = 0;
  let nl;
  const buf = tail + chunk;
  while ((nl = buf.indexOf("\n", from)) !== -1) {
    if (nl > from) handle(buf.slice(from, nl));
    from = nl + 1;
  }
  tail = from < buf.length ? flatten(buf.slice(from)) : "";
  if (Date.now() - lastReport > 15000) {
    lastReport = Date.now();
    process.stderr.write(`${c.lines} lines, ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  }
}
if (tail.trim()) handle(tail);
process.stderr.write("\n");

const topPublishers = [...publishers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
const out = {
  label: LABEL,
  input: INPUT,
  referenceDate: new Date(NOW).toISOString(),
  generatedAt: new Date().toISOString(),
  script: "scripts/census-aggregate.mjs",
  counts: c,
  maintainerHistogram: Object.fromEntries([...maintHist.entries()].sort((a, b) => a[0] - b[0])),
  distinctPublishers: publishers.size,
  topPublishers: topPublishers.map(([account, packages]) => ({ account, packages })),
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
};

const json = JSON.stringify(out, null, 2) + "\n";
if (OUT) writeFileSync(OUT, json);
else process.stdout.write(json);

if (reservoir) {
  const w = createWriteStream(SLICE_OUT);
  /* Sort by package name so the slice file is stable regardless of reservoir
     eviction order, and diffable. */
  const sorted = reservoir.slice().sort((a, b) => (JSON.parse(a).n < JSON.parse(b).n ? -1 : 1));
  for (const l of sorted) w.write(l + "\n");
  w.end();
  console.error(`slice: ${reservoir.length} packages -> ${SLICE_OUT} (seed ${SLICE_SEED})`);
}

const pct = (x) => ((100 * x) / c.packages).toFixed(2) + "%";
console.error(`
${LABEL}: ${c.packages.toLocaleString("en-US")} packages, ${c.parseErrors} unparseable lines, ${out.elapsedSeconds}s
  no versions at all      ${c.noVersions} (${pct(c.noVersions)})
  newest version, 0 maint ${c.maintZero} (${pct(c.maintZero)})
  newest version, 1 maint ${c.maintOne} (${pct(c.maintOne)})
  newest version, 2+ maint ${c.maintTwoPlus} (${pct(c.maintTwoPlus)})
  last publish >= 2 years ${c.staleTwoYears} (${pct(c.staleTwoYears)})
  last publish >= 5 years ${c.staleFiveYears} (${pct(c.staleFiveYears)})
  distinct publishers     ${publishers.size}
`);
