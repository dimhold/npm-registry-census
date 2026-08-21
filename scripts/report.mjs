/**
 * Print the README tables from the published aggregate.
 *
 *   node scripts/report.mjs
 *
 * The README was written by pasting this output. `npm run verify` checks the
 * paste is still faithful, so this is not a convenience, it is the source of
 * the prose numbers.
 */
import { readFileSync } from "node:fs";
import { derive, compare } from "./derive.mjs";

const agg = JSON.parse(readFileSync(new URL("../data/census-full.json", import.meta.url), "utf8"));
const crawl = JSON.parse(readFileSync(new URL("../data/crawl-state.json", import.meta.url), "utf8"));
const sample = JSON.parse(readFileSync(new URL("../data/census-sample-100000.json", import.meta.url), "utf8"));
const d = derive(agg, crawl);
const cmp = compare(agg, sample);

const table = (head, rows) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const row = (r) => [r.label, r.share, d.int(r.count)];

console.log("## Maintainers on the newest version\n");
console.log(table(["maintainers", "share", "packages"], d.maintTable.map(row)));
console.log("\n## Time since the last publish\n");
console.log(table(["last publish", "share", "packages"], d.ageTable.map(row)));
console.log("\n## Versions per package\n");
console.log(table(["versions", "share", "packages"], d.versionTable.map(row)));
console.log("\n## Direct dependencies of the newest version\n");
console.log(table(["dependencies", "share", "packages"], d.depTable.map(row)));
console.log("\n## Top publishing accounts\n");
console.log(
  table(
    ["packages", "account"],
    agg.topPublishers.slice(0, 10).map((p) => [d.int(p.packages), "`" + p.account + "`"]),
  ),
);
console.log("\n## Sample against census\n");
console.log(
  table(
    ["metric", "full census", "sample of 100,000", "difference"],
    cmp.rows.map((r) => [r.label, r.full, r.sample, r.delta]),
  ),
);
console.log("\n## Claims checked by verify.mjs\n");
for (const [k, v] of Object.entries({ ...d.claims, ...cmp.claims })) console.log(`- ${k}: **${v}**`);
