/**
 * Turn the raw counts in data/census-full.json into the numbers the README
 * quotes.
 *
 * Nothing here reads the 20 GB crawl file. It reads counts and divides. The
 * point of keeping it separate is that `scripts/verify.mjs` can re-derive every
 * headline number from the published aggregate and check that the README says
 * exactly that, so a number cannot drift in the prose without the check failing.
 *
 * Denominator note: every share below is over the packages the registry
 * actually returned (`counts.packages`), not over the name list. The name list
 * is larger because some names in the replication index have no package behind
 * them any more. Both figures are printed, so either denominator can be used.
 */

/** Names in the replication index at the time the crawl started. */
export const NAME_LIST = 4305887;

const int = (x) => Number(x).toLocaleString("en-US");
const pct = (x, of, digits = 1) => ((100 * x) / of).toFixed(digits) + "%";

export function derive(agg, crawl) {
  const c = agg.counts;
  const n = c.packages;
  const p = (x, d = 1) => pct(x, n, d);

  const maintTable = [];
  const hist = agg.maintainerHistogram;
  let sixPlus = 0;
  for (const [k, v] of Object.entries(hist)) if (Number(k) >= 6) sixPlus += v;
  for (const k of ["0", "1", "2", "3", "4", "5"]) {
    maintTable.push({ label: k, count: hist[k] ?? 0, share: p(hist[k] ?? 0) });
  }
  maintTable.push({ label: "6 or more", count: sixPlus, share: p(sixPlus) });

  const ageLabels = {
    "<1m": "under a month",
    "1-6m": "1 to 6 months",
    "6-12m": "6 to 12 months",
    "1-2y": "1 to 2 years",
    "2-5y": "2 to 5 years",
    ">5y": "over 5 years",
  };
  const ageTable = Object.entries(c.age).map(([k, v]) => ({
    label: ageLabels[k] ?? k,
    count: v,
    share: p(v),
  }));

  const verLabels = { 1: "1", 2: "2", "3-5": "3 to 5", "6-10": "6 to 10", "11-25": "11 to 25", "26-100": "26 to 100", ">100": "over 100" };
  const versionTable = Object.entries(c.versions).map(([k, v]) => ({
    label: verLabels[k] ?? k,
    count: v,
    share: p(v),
  }));

  const depTable = Object.entries(c.deps).map(([k, v]) => ({
    label: k === "0" ? "none" : k === ">25" ? "over 25" : k.replace("-", " to "),
    count: v,
    share: p(v),
  }));

  /* Claims are (name, exact string) pairs. verify.mjs asserts each string is
     present verbatim in README.md. */
  const claims = {
    "names in the replication index": int(NAME_LIST),
    "packages the registry returned": int(n),
    "names with no package (HTTP 404)": int(crawl.missing),
    "names the crawler never got an answer for": int(crawl.failed),
    "packages with exactly one maintainer, count": int(c.maintOne),
    "packages with exactly one maintainer, share": p(c.maintOne),
    "packages with no maintainer listed, share": p(c.maintZero),
    "packages with no maintainer listed, count": int(c.maintZero),
    "of those, last published by the npm account, count": int(c.maintZeroPublishedByNpm),
    "of those, last published by the npm account, share": pct(c.maintZeroPublishedByNpm, c.maintZero),
    "packages with two or more maintainers, share": p(c.maintTwoPlus),
    "not published in two years, count": int(c.staleTwoYears),
    "not published in two years, share": p(c.staleTwoYears),
    "not published in five years, count": int(c.staleFiveYears),
    "not published in five years, share": p(c.staleFiveYears),
    "packages with no versions at all, count": int(c.noVersions),
    "packages whose newest version has no publish date, count": int(c.noTimeForNewest),
    "unparseable lines in the crawl file": int(c.parseErrors),
    "distinct publishing accounts": int(agg.distinctPublishers),
    "declare an install hook, share": p(c.installHook),
    "declare an install hook, count": int(c.installHook),
    "mean versions per package": (c.versionSum / n).toFixed(1),
    "mean direct dependencies": (c.depSum / n).toFixed(2),
    "packages with one version, share": p(c.versions["1"]),
    "packages with no dependencies, share": p(c.deps["0"]),
    "top publisher": agg.topPublishers[0].account,
    "top publisher, count": int(agg.topPublishers[0].packages),
    "second publisher": agg.topPublishers[1].account,
    "second publisher, count": int(agg.topPublishers[1].packages),
  };

  return { n, claims, maintTable, ageTable, versionTable, depTable, int, pct: p };
}

/**
 * The sample against the census.
 *
 * The 100,000-package sample was drawn first and published first. Now that the
 * full registry has been counted, the interesting question is how wrong the
 * sample was. Both files are aggregated by the same script at the same
 * reference date, so what is left between them is sampling error and nothing
 * else.
 */
export function compare(full, sample) {
  const F = full.counts;
  const S = sample.counts;
  const share = (c, key) => (100 * c[key]) / c.packages;
  const rows = [
    ["exactly one maintainer", "maintOne"],
    ["no maintainer listed", "maintZero"],
    ["two or more maintainers", "maintTwoPlus"],
    ["last publish 2 years or more ago", "staleTwoYears"],
    ["last publish 5 years or more ago", "staleFiveYears"],
    ["declares an install hook", "installHook"],
    ["no versions at all", "noVersions"],
  ].map(([label, key]) => {
    const f = share(F, key);
    const s = share(S, key);
    return {
      label,
      full: f.toFixed(2) + "%",
      sample: s.toFixed(2) + "%",
      delta: (s - f >= 0 ? "+" : "") + (s - f).toFixed(2) + " pp",
      absDelta: Math.abs(s - f),
    };
  });
  const worst = rows.reduce((a, b) => (b.absDelta > a.absDelta ? b : a));
  return {
    rows,
    worst,
    claims: {
      "largest sample error, metric": worst.label,
      "largest sample error, size": worst.absDelta.toFixed(2) + " pp",
      "sample size": int(S.packages),
    },
  };
}
