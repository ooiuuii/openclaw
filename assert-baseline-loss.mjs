import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function assertBaselineLoss(receipt) {
  assert.equal(receipt.outcome, "red");
  assert.equal(receipt.sourceBefore.head, "20e0ed521c00fd38b1d4d003636fa4ddd3bf2066");
  assert.equal(receipt.sourceBefore.status, "");
  assert.deepEqual(receipt.sourceAfter, receipt.sourceBefore);
  assert.equal(receipt.children.length, 2);
  assert.notEqual(receipt.children[0].pid, receipt.children[1].pid);
  for (const child of receipt.children) {
    assert(Number.isInteger(child.pid) && child.pid > 0);
    assert.equal(child.code, 0);
    assert.equal(child.timedOut, false);
  }
  assert.equal(receipt.results.checks.length, 1);
  const check = receipt.results.checks[0];
  assert.equal(check.name, "real-run-end-cleanup");
  assert.equal(check.pass, false);
  assert.equal(check.artifactExists, false, "Baseline RED must be actual artifact deletion");
  assert.equal(check.artifactSha256, null);
  assert.equal(check.worktreeExists, false, "Baseline checkout must actually be removed");
  assert.equal(check.cardExists, true, "The card must still exist after artifact loss");
  assert(check.artifacts.some((artifact) => artifact.path === "dist/report.txt"), "The card must retain the lost artifact reference");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2]);
  const dirs = (await fs.readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
  assert.equal(dirs.length, 1, "Expected exactly one fresh baseline run");
  const receipt = JSON.parse(await fs.readFile(path.join(root, dirs[0].name, "receipt.json"), "utf8"));
  assertBaselineLoss(receipt);
  console.log("Confirmed baseline: actual artifact and checkout deleted; card and exact reference retained; two successful processes; unchanged exact baseline source.");
}
