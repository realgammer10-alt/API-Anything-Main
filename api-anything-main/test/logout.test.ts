import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { addCookiesToProfile, browserAvailable, closeBrowser, profileCookies } from "../src/browser.js";
import { profileDir } from "../src/heal.js";
import { logout } from "../src/login.js";
import { loadSession, saveSession, writePrivate } from "../src/session.js";
import { parseSite } from "../src/spec.js";
import { saveSite } from "../src/store.js";
import type { StoredCookie } from "../src/types.js";

const home = mkdtempSync(join(tmpdir(), "aa-logout-"));
process.env.API_ANYTHING_HOME = home;
after(async () => {
  await closeBrowser();
  rmSync(home, { recursive: true, force: true });
});

const cookie = (domain: string): StoredCookie => ({
  name: "sid",
  value: "synthetic-session-value",
  domain,
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
});

test("logout clears the named site's browser cookies and keeps another site's session", {
  skip: !browserAvailable(),
  timeout: 45_000,
}, async () => {
  saveSite(parseSite({ name: "logical-name", baseUrl: "https://www.audit.test", operations: [] }));
  const own = [cookie(".audit.test"), cookie("api.audit.test")];
  const other = cookie(".other.test");
  saveSession("logical-name", { cookies: own, values: { token: "synthetic-token" } });
  await addCookiesToProfile([...own, other], profileDir());
  await logout("LOGICAL-NAME");
  assert.deepEqual(loadSession("logical-name").cookies, []);
  assert.deepEqual(loadSession("logical-name").values, {});
  assert.deepEqual(await profileCookies({ url: "https://www.audit.test", profileDir: profileDir() }), []);
  assert.equal((await profileCookies({ url: "https://other.test", profileDir: profileDir() })).length, 1);
});

test("a corrupt domain-named spec does not prevent clearing that domain's browser session", {
  skip: !browserAvailable(),
  timeout: 45_000,
}, async () => {
  writePrivate(join(home, "sites/audit.test.json"), "not JSON");
  const own = [cookie(".audit.test")];
  saveSession("audit.test", { cookies: own, values: {} });
  await addCookiesToProfile(own, profileDir());
  await logout("audit.test");
  assert.deepEqual(loadSession("audit.test").cookies, []);
  assert.deepEqual(await profileCookies({ url: "https://audit.test", profileDir: profileDir() }), []);
});
