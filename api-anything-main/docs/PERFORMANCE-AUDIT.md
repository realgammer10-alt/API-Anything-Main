# Repository audit and latency pass

Benchmark baseline: `4a785e8d9e72a00e2dddc0dc56569a86826df07b`. Candidate branch:
`t3/repo-latency-performance-optimization`. The starting worktree was clean. Seven subagents
covered implementation audits and independent execution, data, tooling, and security reviews.
Final source SHA-256: `8589555edb7b7f8e83487edf5e5e6e347d6ae203ca512fb9f5d341389dfc964a`.

API Anything learns reusable website requests, fills their arguments and session references,
and calls them through HTTP or a browser. This review assumes a local CLI/library/MCP user,
including concurrent calls and processes, large response bodies, stale operations, and writes.

## Measured changes

These are local engine and localhost measurements on macOS with Node 25.1.0, not production
site latency. Engine comparisons alternate baseline and candidate for three rounds. Each
round has seven timed batches after warmup; the table reports the median of the three batch
medians, except cookie import as noted below. Both revisions were built for cold
CLI comparisons. Every workload checks its output.

| Workload | Before, ms | After, ms | Reduction |
|---|---:|---:|---:|
| Judge 1,000 JSON records, 224,689-byte body | 4.553 | 2.369 | 48.0% |
| Judge 1,000 records inside an RPC JSON string | 6.683 | 2.540 | 62.0% |
| Pick three fields across 1,000 records | 1.277 | 0.649 | 49.2% |
| Outline a 30,000-key response | 466.012 | 34.847 | 92.5% |
| Full localhost call with 1,000 records and output cap | 5.383 | 3.065 | 43.1% |
| Small localhost call | 0.296 | 0.269 | 9.1%, noisy |
| Cold compiled CLI localhost call | 294.285 | 91.824 | 68.8% |
| Pinned synthetic cookie import, 10 profiles of 3,001 rows | 20.977 | 5.007 | 76.1% |

Import numbers use 15 individual samples after three warmups. Engine `p95BatchMeanMs` measures
batch means, not individual-call tail latency. HTML judging, output capping, and request filling
showed no clear change: median differences were under 2%, with overlapping per-round ranges.
The final cold CLI comparison uses three alternating baseline/candidate rounds after the test
suite ended, with seven fresh processes per arm per round. An earlier three-round run under
full-suite load measured 509.403 to 189.448 ms, a 62.8% reduction, but those absolute times are
load-contaminated. A separate 12-trial probe measured 245.270 to 88.900 ms, a 63.8% reduction.
The table uses the final comparison without concurrent test load.
The CLI result's own `ms` can rise as first-fetch setup moves inside `call`; cold latency here
means the total fresh process wall time, including startup.

- `classify.ts` shares decoded JSON and the selected extraction target within one `judge` call.
  The classifier still sees the original body for errors, shapes, and RPC status decisions.
- `extract.ts` parses pick paths once per projection, rather than once per field per record.
- `outline.ts` and `learn.ts` advance queue cursors rather than repeatedly shifting large arrays.
- `import.ts` filters pinned browsers/profiles before copying and reading cookie databases.
- `cli.ts` loads the MCP SDK only for the `mcp` command. `browser.ts` loads Playwright only
  inside its existing asynchronous Chromium launch functions. Browser-module-only RSS in a
  separate synthetic import probe fell from 148.72 to 63.70 MiB; this is not total app memory.
- `mcp.ts` avoids allocating sparse tables that would exceed the original JSON size. A synthetic
  1,000-record sparse answer previously grew from 12,781 to 5,007,802 characters; it now stays
  12,781 characters. Separate conversion/serialization probes measured about 22.9 to 0.11 ms.

HTTP pacing remains 1 second by default. The localhost throughput workloads explicitly set
`minIntervalMs: 0` to isolate engine overhead. Real sites can be dominated by pacing, network,
browser startup, or site response time, so these percentages do not predict their latency.

## Concrete findings fixed

| Severity | Finding and trigger | Fix and regression coverage |
|---|---|---|
| P1 | Explorer `--name ../../..` resolved cleanup to the checkout root. | Validate a single run name before cleanup or output writes; test only in disposable copies. |
| P1 | A structured parameter containing a cookie/session ref could serialize its example credential and overwrite the descendant ref on replay. New base64 support exposed this existing direct-JSON defect. | Refuse overlapping parameter/ref containers before returning an operation; test direct/base64 containers, siblings, and independent credential/encoding combinations. |
| P2 | Logout used logical names such as `linkedin` rather than `.linkedin.com`, leaving browser authentication active. | Resolve the stored base URL's domain; preserve domain-name fallback for a corrupt spec; verify site isolation in disposable Chrome profiles. |
| P2 | A cached tier-2 origin page navigated to another origin and was reused, causing later calls to fail CORS. | Verify its current origin, replace it with a bounded close, and stop before sending when the deadline expires; test one POST and a hung-close fault. |
| P2 | `String(object)` and comma-joined arrays made different argument sets look equal, skipping a successful example diagnostic. | Compare the existing argument text representation; test object/array collisions for missing data and bare 403 responses. |
| P2 | XSSI text inside a JSON string was split as another payload, turning valid reads into drift. | Parse a complete JSON value first and recognize repeated prefixes only between values; test every supported prefix and malformed framing. |
| P2 | Inherited `toString`/`constructor` properties counted as response data; an own `__proto__` pick field was dropped by the legacy setter. | Read only own properties and preserve the special output field without changing its prototype. |
| P2 | MCP's union-of-fields table expanded sparse data after the hard cap had already been applied. | Keep records whenever a table would grow JSON; retain economical tables and missing-field nulls. Update the agent-facing contract. |
| P2 | Historical chart summaries dropped failed trials and could imply a fully graded, faster batch. | Preserve attempts, failures, and ungraded counts; omit absent numeric measurements; render missing metrics as N/A and label actual grading coverage. |
| P2 | A pinned import scanned unrelated profiles, allowing an unrelated corrupt database to stop recovery. | Filter before database inspection; preserve ambiguity for browser-unspecified pins. |

## Verification and coverage

- Pinned baseline: 578 tests passed, zero failures/skips, plus typecheck, lint, and build.
- Node 25.1.0: 599 tests passed before the final lazy-browser change; afterward, 11 affected
  browser regressions and both compression regressions passed. Typecheck, lint, and build pass.
- Final Node 22.13.0 full suite: 599 passed, zero failures, one unavailable zstd case skipped.
  The initial floor run found a preexisting unconditional fixture import of a Node 22.15 zstd
  API; the fixture now permits the remaining tests to run and explicitly marks that capability
  unavailable. Newer runtimes still exercise zstd.
- Final Node 24.21.0 full suite: 600 passed, zero failures/skips on an unchanged full rerun.
  The preceding full run passed 599 and failed one SIGKILL cleanup deadline assertion. The exact
  case subsequently passed unchanged in both a copied eager-import baseline and the lazy-import
  candidate, then in the complete rerun. The initial failure's cause remains unproven; it is not
  dismissed as a proven preexisting flake, and its assertion was not relaxed.
- Package dry-run: 70 files, with no raw traces or benchmark dumps included.
- Production dependency advisory audit: zero reported vulnerabilities. This does not prove the
  dependencies have no defects.
- Four independent final reviews found no blocking issues after the logout, credential-overlap,
  and chart-rendering corrections. Data comparison probes checked 540 baseline/candidate
  verdict-and-result cases. Independent overlap probes checked 18 encoding/container/credential
  combinations and four nested-cookie cases.

All 19 source modules were covered: browser/execution/HTTP/healing; codec/learning/secrets;
classification/extraction/outlining/spec/types; session/storage/import/login; CLI/MCP/library.
Review also covered their tests and fixtures, bundled specifications, README/design/research/
release documents, package and lockfile, TypeScript/Biome/CI configuration, install/plugin
metadata, examples, the bundled skill, and benchmark/exploration/video tooling. Bundled site
acceptance is static and fixture-based; live websites and real accounts were not exercised.

## Remaining constraints and rejected changes

- **Existing browser write-guard gaps.** DESIGN documents shared-worker traffic, some
  cross-origin frame unload/redirect traffic, and an unsafe redirect from an allowed read.
  This pass preserves the guards; it does not close those architectural gaps.
- **Existing lock fallback.** `session.ts` proceeds unlocked after prolonged contention and can
  take over an old lock. Strict multi-process exclusion under a holder paused over 10 seconds
  remains unqualified. Locks were not weakened for latency.
- **One transient qualification failure remains unexplained.** The SIGKILL test waits for any
  Chrome process, sleeps a second, then allows five seconds for every profile-bearing process
  to disappear. It does not establish page/capture readiness. Both variants passed isolated
  probes and the final complete run passed, but that does not explain the earlier surviving
  process. A recurrence needs PID/state and page-readiness evidence, with the assertion retained.
- **Credential recognition has documented limits.** Unrecognized, split, deeply encoded, or
  caller-supplied credentials outside inferred refs are not made safe by the new overlap guard.
- **Capture waits remain expensive.** A matched response plus unrelated hanging traffic took
  about 6.05 seconds under a 6-second budget. Dropping unmatched bodies would discard bootstrap
  evidence used to identify credentials, so that shortcut was rejected.
- Native JSON parsing was rejected because it rounds large integer IDs. Persistent response,
  session, or spec caches were rejected because they can hide changes. Default pacing,
  authorization, validation, redirects, output caps, and write retry rules were preserved.
- No live-site, real-account, or production performance qualification. Local verification
  used macOS; Linux CI qualification is recorded separately on the pull request. No dependency
  changes.

## Reproduce

```sh
npm ci
npm run build
perf_baseline=$(mktemp -d /tmp/api-anything-baseline.XXXXXX)
git archive 4a785e8d9e72a00e2dddc0dc56569a86826df07b | tar -x -C "$perf_baseline"
ln -s "$PWD/node_modules" "$perf_baseline/node_modules"
npm run build --prefix "$perf_baseline"
node --import tsx bench/engine.mjs --repo "$perf_baseline" --revision 4a785e8d9e72a00e2dddc0dc56569a86826df07b
node --import tsx bench/engine.mjs --revision working-tree
node --import tsx bench/import.mjs --repo "$perf_baseline"
node --import tsx bench/import.mjs
npm run check
npm run lint
npm test
npm exec --yes --package=node@22.13.0 -- node --import tsx --test test/*.test.ts test/edge/*.test.ts
npm exec --yes --package=node@24 -- node --import tsx --test test/*.test.ts test/edge/*.test.ts
```

Alternate the engine baseline/candidate commands three times for the reported protocol. Raw
measurement JSON, traces, and test logs remain local under `/tmp/api-anything-*`; the scripts
and this concise report are the reviewable deliverables.
