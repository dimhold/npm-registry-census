# npm registry census, August 2026

Every name in the npm registry, fetched from the registry itself and counted.
This is not the 14 popular stacks that show up in blog posts and it is no
longer a sample: the crawler walked the whole replication index, 4,305,887
names, and the registry answered for 4,296,340 of them.

The crawl ran from 2026-08-19 09:15 UTC to 2026-08-21 09:15 UTC at 25 requests a
second, held to that rate on purpose because the registry is a public service
and this was a long visit. 9,546 names are in the index with no package behind
them any more (HTTP 404). Exactly 1 name never produced an answer after 5
attempts. There were 5 moments where the registry asked the crawler to slow
down, and it did.

Every share below is over the 4,296,340 packages that returned data, and every
one of them is a division of two raw counts in `data/census-full.json`. Run
`npm run verify` to re-derive them and check this text against them.

## What it found

**84.9% of npm packages list exactly one maintainer.** That is 3,647,096
packages where a single account can publish. 11.0% list 2 or more accounts and
4.0% list none at all, which is a stranger category than it sounds and is taken
apart below.

**65.8% have not been published to in 2 years or more.** That is 2,825,588
packages. 32.8%, or 1,410,744 packages, have not been published to in 5 years.
Packages touched in the last month are 6.2% of the registry.

**37.4% have exactly one version.** Published once, never updated.

**38.5% declare no dependencies at all.** The mean is 4.57 direct dependencies,
and the mean describes nothing: the distribution is split between packages that
were published once with nothing in them and a much smaller set of live
packages with real trees.

**There are 1,056,758 distinct publishing accounts,** and the two largest are
not people. `npm` published the newest version of 150,784 packages and
`GitHub Actions` published the newest version of 147,917.

**1.74% run code when you install them,** which is 74,664 packages, not the
6.36% you get by grepping `package.json` for lifecycle scripts. The gap is
`prepare`, declared by 198,614 packages and run by none of their installers.

## Three things this does not say

These are not footnotes. They change what the numbers above mean.

**A maintainer here is a publishing account, not a person.** The number comes
from the `maintainers` array of the newest version, which is the registry's
answer to "who is allowed to publish this". An account can be a bot, a CI
identity, a shared company login or a person. The top of the publisher table
proves the point: the first two rows are `npm` itself and `GitHub Actions`.
So "84.9% have one maintainer" means one account holds the publish right, and
whether a human is behind it is a separate question this data cannot answer.
The same caution applies to the 4.0% with no maintainer listed at all. There are
173,979 of those, and 135,533 of them, 77.9%, had their newest version published
by the `npm` account. That is the registry doing housekeeping, republishing a
package it removed as a `0.0.1-security` stub under its own name with an empty
maintainer list. Reading that bucket as 174 thousand abandoned packages would be
wrong.

**This is the registry as a warehouse, not as what people install.** Every
package counts once, whether it is downloaded a billion times a week or zero
times ever. A census weighted by downloads would produce completely different
numbers and would answer a different question. Both questions are real. Quoting
one of these figures as though it described the packages in a working
`node_modules` would be wrong.

**The snapshot is 2026-08-21 and it is smeared across 48 hours.** A package
fetched in the first hour of the crawl and a package fetched in the last hour
were read 2 days apart. Ages are measured against the moment the crawl
finished, 2026-08-21T09:15:31Z. At this scale a 2 day smear moves nothing
visible, and it is still true.

## Maintainers on the newest version

| maintainers | share | packages |
|---|---|---|
| 0 | 4.0% | 173,979 |
| 1 | 84.9% | 3,647,096 |
| 2 | 4.3% | 184,906 |
| 3 | 1.9% | 82,315 |
| 4 | 1.4% | 61,197 |
| 5 | 0.8% | 35,894 |
| 6 or more | 2.5% | 109,020 |

The full histogram, out to the single package listing 830 maintainers, is in
`data/census-full.json` under `maintainerHistogram`.

## Time since the last publish

| last publish | share | packages |
|---|---|---|
| under a month | 6.2% | 267,991 |
| 1 to 6 months | 11.2% | 480,028 |
| 6 to 12 months | 7.6% | 325,961 |
| 1 to 2 years | 9.2% | 394,839 |
| 2 to 5 years | 32.9% | 1,414,844 |
| over 5 years | 32.8% | 1,410,744 |

## Versions per package

| versions | share | packages |
|---|---|---|
| 1 | 37.4% | 1,608,047 |
| 2 | 12.6% | 539,513 |
| 3 to 5 | 18.0% | 774,707 |
| 6 to 10 | 12.3% | 528,105 |
| 11 to 25 | 10.7% | 461,428 |
| 26 to 100 | 6.6% | 281,653 |
| over 100 | 2.3% | 100,954 |

Mean versions per package: 16.5.

## Direct dependencies of the newest version

| dependencies | share | packages |
|---|---|---|
| none | 38.5% | 1,653,429 |
| 1 to 2 | 28.1% | 1,209,287 |
| 3 to 5 | 15.9% | 681,039 |
| 6 to 10 | 9.5% | 407,816 |
| 11 to 25 | 5.7% | 246,255 |
| over 25 | 2.2% | 96,581 |

`dependencies` only. No `devDependencies`, `peerDependencies` or
`optionalDependencies`.

## Top publishing accounts

The account that published the newest version, counted across the registry.

| packages | account |
|---|---|
| 150,784 | `npm` |
| 147,917 | `GitHub Actions` |
| 30,365 | `terryfei` |
| 11,403 | `types` |
| 10,923 | `rajhsinggg` |
| 10,531 | `ayowel` |
| 10,012 | `mayangsario` |
| 7,013 | `ryliefrey` |
| 6,752 | `bedlaj` |
| 6,444 | `arcodesign-bot` |

The top 50 are in `data/census-full.json`.

## Install hooks: 1.74%, and why you will see 6.36%

**74,664 packages, 1.74% of the registry, run code on the machine of whoever
installs them.** That is `preinstall`, `install` or `postinstall` declared in the
newest version.

Counting all 4 lifecycle scripts gives 273,278 packages and 6.36%. That is what a
grep over `package.json` returns and it is 3.66x too high.

The whole difference is `prepare`. 198,614 packages declare `prepare` and nothing
else, which is 61.4% of the 323,536 candidates the first pass flagged. `prepare`
does not run for somebody installing a published tarball from the registry. It
runs for whoever builds the package from source or pulls it out of git.

| | packages | % of registry |
|---|---|---|
| **runs code on install** | **74,664** | **1.74** |
| postinstall | 49,813 | 1.16 |
| install | 17,692 | 0.41 |
| preinstall | 9,432 | 0.22 |
| declares `prepare` only | 198,614 | 4.62 |
| had a hook once, not in the newest version | 50,258 | 1.17 |

The 3 hook rows sum to more than 74,664 because a package can declare several.

An earlier version of this file gave 6.4% and said it was an upper bound because
the crawler stored the 4 hooks as a single bit. The second pass replaces that
number. 323,556 candidates were re-fetched by name on 2026-08-21, 0 errors, 20
gone from the registry between the passes.

### Check what prepare does before believing any of this

Everything above rests on one claim, so do not take it from the docs. It takes 2
minutes and none of the data here.

```bash
mkdir -p probe/pkg probe/consumer && cd probe/pkg
cat > package.json <<'EOF'
{
  "name": "hook-probe",
  "version": "1.0.0",
  "scripts": {
    "preinstall":  "node -e \"console.log('RAN preinstall')\"",
    "install":     "node -e \"console.log('RAN install')\"",
    "postinstall": "node -e \"console.log('RAN postinstall')\"",
    "prepare":     "node -e \"console.log('RAN prepare')\""
  }
}
EOF
npm pack
cd ../consumer && npm init -y
npm install --foreground-scripts ../pkg/hook-probe-1.0.0.tgz
```

`--foreground-scripts` is not optional. Without it npm swallows hook output and
the run looks like nothing fired at all.

On node 22.17.0 and npm 10.9.2:

| how it is installed | preinstall | install | postinstall | prepare |
|---|---|---|---|---|
| tarball from the registry | yes | yes | yes | **no** |
| `npm install` inside the package itself | yes | yes | yes | yes |
| as a git dependency | yes | yes | yes | yes, first |

Row 1 is an ordinary install. Rows 2 and 3 are building, not consuming. In the
git case `prepare` runs before `preinstall`, because the package is built from
source and only then installed.

### What this does not say

- It counts a declared hook, not what the hook does. Nothing here was executed
  and no script body was stored, so this dataset cannot tell a native build from
  anything else.
- It counts direct installs. How far these 74,664 reach through transitive
  dependencies is a separate measurement and is not in this repository.
- Newest version means newest by publish time from the `time` map, not by semver
  order. Spot checked against `dist-tags.latest`, which agreed on every row
  checked.
- npm 10.9.2. The lifecycle set has changed across major versions of npm.

## The sample was right, within 0.16 points

Before this census a sample of 100,000 names was drawn with seed 20260819 and
published. The census makes it possible to ask how wrong a sample of that size
is on this registry. Both files were aggregated by the same script at the same
reference date, so what is left between the two columns is sampling error.

| metric | full census | sample of 100,000 | difference |
|---|---|---|---|
| exactly one maintainer | 84.89% | 84.73% | -0.16 pp |
| no maintainer listed | 4.05% | 4.10% | +0.05 pp |
| two or more maintainers | 11.02% | 11.13% | +0.11 pp |
| last publish 2 years or more ago | 65.77% | 65.68% | -0.09 pp |
| last publish 5 years or more ago | 32.84% | 32.91% | +0.08 pp |
| declares any of the 4 hooks | 6.38% | 6.29% | -0.09 pp |
| no versions at all | 0.04% | 0.04% | -0.00 pp |

The worst error across every metric measured is 0.16 pp, on exactly one
maintainer. A uniform sample of 99,751 packages described a registry of
4,296,340 to within a fifth of a percentage point. That is the theoretically
expected result and it is worth having in hand rather than assuming, because it
says a 48 hour full crawl was not required to get these shares, only to prove
them.

It does move the published figures. The sample said 84.7% and 65.6%. The census
says 84.9% and 65.8%. Both sample figures were correct as sample estimates and
both are superseded here.

One row of that table deserves a warning. The sample said 6.29% of packages
declare an install hook, the census said 6.38%, and the agreement is real. The
number is still the wrong answer to the question people ask it, because 4.62 of
those 6.38 points are `prepare` and `prepare` never runs on the installing
machine. A larger sample would have agreed even more closely and stayed just as
wrong. The error sat in the definition, where sample size has no purchase on
it.

## How to repeat this

Everything in `data/` can be rebuilt from the registry with Node 22 or newer, no
API key and no login:

```sh
npm run census
```

That is three steps in sequence and it takes roughly 50 hours:

1. `npm run names` pages the replication index and writes
   `scripts/registry-names.txt`, one package name per line, about 89 MB.
   Roughly 40 minutes.
2. `npm run crawl` fetches every name at 25 requests a second and writes
   `scripts/npm-all.ndjson`, one slim record per package, 20.6 GB. Roughly 48
   hours. Both of these write next to the script, not to the repository root.
   It is resumable: the output file is the state, so killing it costs nothing.
   `touch scripts/PAUSE-CRAWL` stops it politely.
3. `npm run aggregate` makes one streaming pass over that file and writes
   `data/census-full.json`. Roughly 5 minutes, needs about 2.5 GB of heap.

The 20.6 GB crawl output is deliberately not published here. It is derived data
that anybody can regenerate from the registry with step 2, and a copy in git
would be a stale mirror of a public service.

To check this repository without recrawling anything, in seconds:

```sh
npm run verify
```

That does three things. It checks the crawler's own state file against the
aggregate, so a truncated or swapped file shows up. It re-derives every number
quoted in this README from the raw counts in `data/census-full.json` and fails
if the prose and the data disagree. Then it re-runs the counting script, in your
clone, on `data/slice-5000.ndjson.gz` and requires it to reproduce
`data/census-slice.json` exactly.

That third check is the one that matters and it is worth being precise about
what it proves. It proves the aggregates here came out of the code here, on real
crawl records you can read yourself. It does not prove the full totals. Nothing
short of recrawling the registry proves the full totals, which is why step 2
exists.

## The slice

`data/slice-5000.ndjson.gz` is 5,000 packages drawn from the census file by
reservoir sampling with seed 20260821, 2.5 MB compressed and 26 MB open. It is
real crawl output in the real format, so the method can be read, run and
disagreed with without downloading 20.6 GB. It is not a substitute for the
census and its own shares differ from the census shares by up to a percentage
point, which is what a sample of 5,000 does.

## Files

| file | what |
|---|---|
| `data/census-full.json` | all counts from the full census, plus the maintainer histogram and top 50 publishers |
| `data/census-sample-100000.json` | the same counts for the earlier 100,000 sample, same script, same reference date |
| `data/census-slice.json` | the same counts for the published slice |
| `data/slice-5000.ndjson.gz` | 5,000 raw crawl records |
| `data/hooks-full.json` | the install hook counts, from the second pass |
| `data/hooks-slice.json` | every 160th candidate of the second pass with its verdict, 2,023 rows, for spot checking against the live registry |
| `data/crawl-state.json` | what the crawler recorded: packages written, 404s, failures, throttles, bytes |
| `data/crawl-status-as-run.md` | the crawler's own progress file, verbatim as it finished. Its labels are in Russian, which is the author's working language. `data/crawl-state.json` carries the same numbers with English keys |
| `scripts/replica-names.mjs` | step 1, pages `replicate.npmjs.com` for every package name |
| `scripts/crawl-npm.mjs` | step 2, the crawler, byte for byte as it ran. Its progress messages are in Russian for the same reason |
| `scripts/census-aggregate.mjs` | step 3, one streaming pass, raw counts out |
| `scripts/derive.mjs` | counts to percentages. The only place a share is computed |
| `scripts/report.mjs` | prints the tables above from the aggregate |
| `scripts/verify.mjs` | the check described above |
| `scripts/hooks-pass.mjs` | the second pass, re-fetches every flagged package and records which of the 4 hooks each version declares |
| `scripts/hooks-aggregate.mjs` | the second pass counted, and the slice written |

## What to argue with

Places this is weak, listed so nobody has to find them:

- **Install hooks are an upper bound**, for the reason given above. This is the
  softest number here.
- **`maintainers` is an ACL, not a headcount.** An organization with 50 people
  can appear as one account. A solo developer can appear as 3. The
  census counts what the registry serves.
- **The newest version is the one with the latest date in `time`**, not
  `dist-tags.latest`. On a package that has not moved in 5 years they are the
  same. On a live package publishing prereleases they are not, and this counts
  the prerelease.
- **`time` is the registry's word.** Publish dates are not independently
  verified here, and republished or transferred packages can carry dates that
  do not mean what they look like.
- **9,546 names returned 404 and are absent from every share.** They are in the
  replication index and have no package. Folding them into the denominator
  would move every share by at most 0.22%.
- **A package with no versions is counted in the denominator and skipped
  everywhere else.** There are 1,933 of them, 0.04%.
- **One name, out of 4,305,887, never answered.** It is unmeasured and unnamed,
  because the crawler counted the failure without recording which name it was.
- **The crawler introduced itself to npm under the wrong name.** Its user agent
  string says `github.com/dimhold/dep-weight`, which is where this work started
  and which holds a different study. The script is published here unedited,
  user agent included, because changing it after the fact would make the file
  stop being the thing that ran.
- **Scoped and unscoped names are counted the same way.** No attempt was made to
  group packages by organization, which would lower the "one maintainer" share
  by an amount this data cannot estimate.

## License

MIT. See `LICENSE`.
