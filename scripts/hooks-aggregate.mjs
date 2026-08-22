// Собирает публикуемый агрегат и проверочный срез из npm-hooks.ndjson.
// Сам ndjson весит 727 МБ и в репозиторий не идёт: наружу уходят числа,
// скрипты и срез, по которому счёт можно перепроверить руками.
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const TOTAL_REGISTRY = 4296340;
const SLICE_EVERY = 160; // ~2000 строк среза
const IGNORE = new Set(["created", "modified"]);

const agg = {
  registryTotal: TOTAL_REGISTRY,
  candidatesScanned: 0,
  runsOnInstall: 0,
  prepareOnly: 0,
  hadHookNotAnyMore: 0,
  everRanOnInstall: 0,
  byHook: { preinstall: 0, install: 0, postinstall: 0 },
};
const slice = [];
let n = 0;

const rl = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  agg.candidatesScanned++;
  const r = JSON.parse(line);

  let latest = null, latestAt = -1;
  for (const [ver, when] of Object.entries(r.t ?? {})) {
    if (IGNORE.has(ver)) continue;
    const at = Date.parse(when);
    if (Number.isFinite(at) && at > latestAt) { latestAt = at; latest = ver; }
  }
  const versions = r.v ?? {};
  if (Object.values(versions).some((v) => v.c?.length)) agg.everRanOnInstall++;
  if (!latest) continue;

  const v = versions[latest];
  let verdict;
  if (!v) verdict = "clean-now";
  else if (v.c?.length) { verdict = "runs-on-install"; for (const h of v.c) agg.byHook[h]++; }
  else if (v.b?.length) verdict = "prepare-only";
  else verdict = "clean-now";

  if (verdict === "runs-on-install") agg.runsOnInstall++;
  else if (verdict === "prepare-only") agg.prepareOnly++;
  else agg.hadHookNotAnyMore++;

  if (n++ % SLICE_EVERY === 0) {
    slice.push({ name: r.n, latest, verdict, hooks: v?.c ?? [], builderHooks: v?.b ?? [] });
  }
}

const naive = agg.runsOnInstall + agg.prepareOnly;
agg.naiveAllFourHooks = naive;
agg.pct = {
  runsOnInstall: +((agg.runsOnInstall / TOTAL_REGISTRY) * 100).toFixed(4),
  prepareOnly: +((agg.prepareOnly / TOTAL_REGISTRY) * 100).toFixed(4),
  naiveAllFourHooks: +((naive / TOTAL_REGISTRY) * 100).toFixed(4),
};
agg.inflationFactor = +(naive / agg.runsOnInstall).toFixed(3);

writeFileSync("hooks-full.json", JSON.stringify(agg, null, 2));
writeFileSync("hooks-slice.json", JSON.stringify({
  note: "Every 160th candidate, in crawl order. Spot check any row against the live registry.",
  generated: "2026-08-22",
  rows: slice,
}, null, 2));
console.log(JSON.stringify(agg, null, 2));
console.log("срез строк:", slice.length);
