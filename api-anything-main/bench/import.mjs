// Synthetic pinned-profile import latency. No real browser state or accounts.
// Build first; run: node --import tsx bench/import.mjs [--repo /path/to/baseline]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeFirefoxDb } from "../test/fixture/cookie-db.ts";

const { values } = parseArgs({ options: { repo: { type: "string" } } });
const repo = resolve(values.repo ?? join(import.meta.dirname, ".."));
const { importFromBrowsers } = await import(pathToFileURL(join(repo, "dist/import.js")).href);
const root = mkdtempSync(join(tmpdir(), "aa-import-bench-"));
const previousRoots = process.env.API_ANYTHING_BROWSER_ROOTS;
const profiles = 10;
const rowsPerProfile = 3001;
const samples = 15;
try {
  const rows = Array.from({ length: rowsPerProfile - 1 }, (_, i) => ({
    host_key: `site${i}.invalid`,
    name: "tracking",
    value: "synthetic-value",
  }));
  for (let i = 0; i < profiles; i++)
    makeFirefoxDb(join(root, `profile-${i}`), [
      ...rows,
      { host_key: "audit.test", name: "sid", value: "synthetic-session" },
    ]);
  process.env.API_ANYTHING_BROWSER_ROOTS = JSON.stringify([{ name: "Firefox", family: "firefox", root }]);
  const times = [];
  for (let i = 0; i < samples + 3; i++) {
    const start = performance.now();
    const imported = importFromBrowsers({
      url: "https://audit.test",
      pin: { browser: "Firefox", profile: "profile-0" },
    });
    const ms = performance.now() - start;
    assert.equal(imported?.source, "firefox:profile-0");
    assert.deepEqual(
      imported.cookies.map((c) => [c.domain, c.name, c.value]),
      [["audit.test", "sid", "synthetic-session"]],
    );
    if (i >= 3) times.push(ms);
  }
  times.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      benchmark: "pinned-import",
      node: process.version,
      profiles,
      rowsPerProfile,
      samples,
      medianMs: times[times.length >> 1],
      p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    }),
  );
} finally {
  if (previousRoots === undefined) delete process.env.API_ANYTHING_BROWSER_ROOTS;
  else process.env.API_ANYTHING_BROWSER_ROOTS = previousRoots;
  rmSync(root, { recursive: true, force: true });
}
