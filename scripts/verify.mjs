/**
 * Check that this repository stands behind its own README.
 *
 *   npm run verify
 *
 * Three things, in the order they can fail:
 *
 * 1. The crawl log and the aggregate agree. `state-crawl-all.json` says the
 *    crawler wrote N packages; the aggregate says it read N lines. If a file
 *    were truncated or swapped, this is where it shows.
 *
 * 2. Every headline number in README.md is re-derived from data/census-full.json
 *    and matched verbatim against the prose. A number edited by hand in the
 *    README, or an aggregate replaced without rewriting the text, fails here.
 *
 * 3. The counting script is re-run, in this clone, on the published slice, and
 *    has to reproduce data/census-slice.json exactly. This is what proves the
 *    aggregates in data/ came out of the code in scripts/ rather than out of a
 *    text editor. It does not prove the full totals, which cannot be checked
 *    without recrawling the registry. See README, "How to repeat this".
 */
import { readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { derive } from "./derive.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

const agg = read("data/census-full.json");
const crawl = read("data/crawl-state.json");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

console.log("\n1. crawl log against aggregate");
if (agg.counts.packages === crawl.ok) ok(`crawler wrote ${crawl.ok} packages, aggregate read the same`);
else bad(`crawler wrote ${crawl.ok} packages, aggregate read ${agg.counts.packages}`);
if (agg.counts.parseErrors === 0) ok("no unparseable lines");
else bad(`${agg.counts.parseErrors} unparseable lines`);
if (crawl.ok + crawl.missing + crawl.failed === 4305887) ok("ok + missing + failed covers the whole name list");
else bad(`ok + missing + failed = ${crawl.ok + crawl.missing + crawl.failed}, name list is 4305887`);

console.log("\n2. README numbers re-derived from data/census-full.json");
const { claims } = derive(agg, crawl);
for (const [label, value] of Object.entries(claims)) {
  if (readme.includes(value)) ok(`${label}: ${value}`);
  else bad(`${label}: derived ${value}, not found in README.md`);
}

console.log("\n3. counting script re-run on the published slice");
const slice = join(ROOT, "data/slice-5000.ndjson.gz");
const expected = read("data/census-slice.json");
if (!existsSync(slice)) {
  bad("data/slice-5000.ndjson.gz is missing");
} else {
  const out = join(tmpdir(), `census-verify-${process.pid}.json`);
  execFileSync(process.execPath, [
    join(ROOT, "scripts/census-aggregate.mjs"),
    slice,
    "--label", expected.label,
    "--now", expected.referenceDate,
    "--out", out,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  const got = JSON.parse(readFileSync(out, "utf8"));
  rmSync(out, { force: true });
  for (const field of ["counts", "maintainerHistogram", "distinctPublishers", "topPublishers"]) {
    if (JSON.stringify(got[field]) === JSON.stringify(expected[field])) ok(`slice ${field} reproduced`);
    else bad(`slice ${field} differs from data/census-slice.json`);
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
