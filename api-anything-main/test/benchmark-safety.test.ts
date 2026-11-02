import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the exploration benchmark refuses traversal before deleting state or launching a paid agent", () => {
  for (const name of ["../../..", "../outside", "nested/run", "nested\\run", "/tmp/outside"]) {
    const repo = mkdtempSync(join(tmpdir(), "aa-bench-safety-"));
    try {
      mkdirSync(join(repo, "bench/explore"), { recursive: true });
      const script = join(repo, "bench/explore/run-explore.mjs");
      copyFileSync(fileURLToPath(new URL("../bench/explore/run-explore.mjs", import.meta.url)), script);
      copyFileSync(
        fileURLToPath(new URL("../bench/run-agents.mjs", import.meta.url)),
        join(repo, "bench/run-agents.mjs"),
      );
      const sentinel = join(repo, "must-remain");
      writeFileSync(sentinel, "preserve this checkout");
      const result = spawnSync(process.execPath, [script, "--name", name, "--prompt", join(repo, "missing-prompt")], {
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /--name must be a run name/);
      assert.doesNotMatch(result.stderr, /ENOENT|spawn claude/);
      assert.equal(existsSync(sentinel), true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});
