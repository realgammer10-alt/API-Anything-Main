import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSites } from "../src/monitor.js";
import { parseSite } from "../src/spec.js";
import { saveSite } from "../src/store.js";
import { startFixture, type Fixture } from "./fixture/server.js";

const HOME = mkdtempSync(join(tmpdir(), "api-anything-monitor-"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "src", "cli.ts");
const execFileAsync = promisify(execFile);
let fixture: Fixture;

process.env.API_ANYTHING_HOME = HOME;

before(async () => {
  fixture = await startFixture();
});

after(async () => {
  await fixture.close();
  rmSync(HOME, { recursive: true, force: true });
});

function savedSite(name: string, operations: unknown[]) {
  const site = parseSite({
    name,
    baseUrl: fixture.url,
    operations,
  });
  saveSite(site);
  return site;
}

const userOperation = (name = "getUser") => ({
  name,
  readOnly: true,
  trigger: { url: `${fixture.url}/spa/{name}` },
  match: { method: "GET", path: "/api/spa/user" },
  request: { method: "GET", url: `${fixture.url}/api/spa/user?name=alice`, headers: {} },
  slots: [{ param: "name", at: ["query:name"] }],
  params: [{ name: "name", example: "alice" }],
});

test("health checks call read operations and skip writes or missing required examples", async () => {
  const site = savedSite("monitor-safe", [
    userOperation(),
    {
      name: "sendMessage",
      readOnly: false,
      trigger: { url: `${fixture.url}/compose` },
      request: { method: "POST", url: `${fixture.url}/api/follow?user=alice`, headers: {} },
      params: [{ name: "user", example: "alice" }],
    },
    {
      ...userOperation("missingExample"),
      params: [{ name: "name" }],
    },
  ]);
  const callsBefore = fixture.calls.length;
  const snapshot = await checkSites([site], { maxTier: 1, minIntervalMs: 0 });

  assert.deepEqual(
    snapshot.results.map(({ operation, status }) => [operation, status]),
    [
      ["getUser", "up"],
      ["sendMessage", "skipped"],
      ["missingExample", "skipped"],
    ],
  );
  assert.equal(snapshot.ok, true);
  assert.equal(
    fixture.calls.slice(callsBefore).filter((request) => request.path.startsWith("/api/spa/user")).length,
    1,
  );
  assert.equal(fixture.calls.some((request) => request.path.startsWith("/api/follow")), false);
  assert.match(snapshot.results[1]!.reason ?? "", /writes are never executed/);
  assert.match(snapshot.results[2]!.reason ?? "", /no example or default/);
});

test("failed endpoint responses become down health checks with the API call's failure class", async () => {
  const site = savedSite("monitor-down", [userOperation()]);
  const fetchImpl: typeof fetch = async () => new Response("slow down", { status: 429 });
  const snapshot = await checkSites([site], { fetchImpl, maxTier: 1, minIntervalMs: 0 });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.down, 1);
  assert.equal(snapshot.results[0]!.status, "down");
  assert.equal(snapshot.results[0]!.class, "rate");
  assert.ok(snapshot.results[0]!.latencyMs! >= 0);
});

test("unexpected errors are isolated to the affected operation and remain visible", async () => {
  const site = savedSite("monitor-errors", [userOperation("first"), userOperation("second")]);
  const snapshot = await checkSites(
    [site],
    {},
    async (_site, operation) => {
      if (operation === "first") throw new Error("transport unavailable");
      return { ok: true, class: "ok", ms: 4, tier: 1, data: {} };
    },
  );

  assert.equal(snapshot.ok, false);
  assert.deepEqual(
    snapshot.results.map(({ status, reason }) => [status, reason]),
    [
      ["down", "health check failed: transport unavailable"],
      ["up", undefined],
    ],
  );
});

test("monitor CLI emits one JSON snapshot and validates interval/count", async () => {
  mkdirSync(join(HOME, "sites"), { recursive: true });
  writeFileSync(
    join(HOME, "sites", "monitor-cli.json"),
    JSON.stringify({
      name: "monitor-cli",
      baseUrl: fixture.url,
      operations: [userOperation()],
    }),
  );
  const env = { ...process.env, API_ANYTHING_HOME: HOME };
  const command = (args: string[]) =>
    execFileAsync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: ROOT, env }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code?: string | number; stdout: string; stderr: string }) => ({
        code: Number(error.code ?? 1),
        stdout: error.stdout,
        stderr: error.stderr,
      }),
    );

  const result = await command(["monitor", "monitor-cli", "--count", "1", "--interval", "1", "--max-tier", "1"]);
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.up, 1);
  assert.equal(output.results[0].operation, "getUser");

  const invalidInterval = await command(["monitor", "monitor-cli", "--interval", "0"]);
  assert.equal(invalidInterval.code, 1);
  assert.match(JSON.parse(invalidInterval.stdout).error, /--interval must be an integer/);

  const invalidCount = await command(["monitor", "monitor-cli", "--count", "many"]);
  assert.equal(invalidCount.code, 1);
  assert.match(JSON.parse(invalidCount.stdout).error, /--count must be a positive integer/);
});
