import assert from "node:assert/strict";
import test from "node:test";
import { assertBaselineLoss } from "./assert-baseline-loss.mjs";

function baseline() {
  const source = { head: "20e0ed521c00fd38b1d4d003636fa4ddd3bf2066", status: "" };
  return {
    outcome: "red", sourceBefore: source, sourceAfter: structuredClone(source),
    children: [{ pid: 101, code: 0, timedOut: false }, { pid: 102, code: 0, timedOut: false }],
    results: { checks: [{ name: "real-run-end-cleanup", pass: false, artifactExists: false, artifactSha256: null, worktreeExists: false, cardExists: true, artifacts: [{ path: "dist/report.txt" }] }] },
  };
}
test("accepts the exact actual-loss observation", () => assert.doesNotThrow(() => assertBaselineLoss(baseline())));
for (const [name, mutate] of [
  ["generic RED with intact bytes", (r) => { r.results.checks[0].artifactExists = true; r.results.checks[0].artifactSha256 = "intact"; }],
  ["retained checkout", (r) => { r.results.checks[0].worktreeExists = true; }],
  ["metadata mismatch", (r) => { r.results.checks[0].artifacts[0].path = "another.txt"; }],
  ["missing card", (r) => { r.results.checks[0].cardExists = false; }],
  ["source drift", (r) => { r.sourceAfter.head = "another-head"; }],
  ["failed worker", (r) => { r.children[0].code = 1; }],
]) test(`rejects ${name}`, () => { const r = baseline(); mutate(r); assert.throws(() => assertBaselineLoss(r)); });
