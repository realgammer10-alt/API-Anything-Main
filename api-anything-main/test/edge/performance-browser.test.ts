import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { browserAvailable, closeBrowser, openBrowser, pageFetch } from "../../src/browser.js";
import { startFixture } from "../fixture/server.js";

test("tier 2 replaces a cached page that navigated to another origin between calls", {
  skip: !browserAvailable(),
}, async () => {
  const home = mkdtempSync(join(tmpdir(), "api-anything-page-origin-"));
  process.env.API_ANYTHING_HOME = home;
  const profileDir = join(home, "profile");
  const fx = await startFixture();
  try {
    const first = await pageFetch({
      origin: fx.url,
      url: `${fx.url}/api/spa/user?name=alice`,
      method: "GET",
      headers: {},
      profileDir,
    });
    assert.equal(first.status, 200);
    const ctx = await openBrowser({ profileDir });
    const page = ctx.pages().find((p) => p.url() === `${fx.url}/`);
    assert.ok(page);
    await page.goto(fx.url.replace("127.0.0.1", "localhost"), { waitUntil: "domcontentloaded" });

    const second = await pageFetch({
      origin: fx.url,
      url: `${fx.url}/api/sw-write`,
      method: "POST",
      headers: {},
      body: "one send",
      profileDir,
      retryOnNavigation: false,
    });
    assert.equal(second.status, 200);
    assert.equal(page.isClosed(), true);
    const writes = fx.calls.filter((c) => c.path === "/api/sw-write");
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.body, "one send");
    assert.equal(writes[0]?.headers["sec-fetch-site"], "same-origin");

    const replacement = ctx.pages().find((p) => p.url() === `${fx.url}/`);
    assert.ok(replacement);
    await replacement.goto(fx.url.replace("127.0.0.1", "localhost"), { waitUntil: "domcontentloaded" });
    replacement.close = () => new Promise(() => {});
    const t0 = Date.now();
    await assert.rejects(
      pageFetch({
        origin: fx.url,
        url: `${fx.url}/api/sw-write`,
        method: "POST",
        headers: {},
        body: "must not send",
        profileDir,
        timeoutMs: 1500,
      }),
    );
    assert.ok(Date.now() - t0 < 4000, "closing a stale page ignored the call's deadline");
    assert.equal(fx.calls.filter((c) => c.path === "/api/sw-write").length, 1);
  } finally {
    await closeBrowser();
    await fx.close();
    rmSync(home, { recursive: true, force: true });
  }
});
