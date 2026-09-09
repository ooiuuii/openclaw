import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const workspace = process.env.GITHUB_WORKSPACE;
if (!workspace || !path.isAbsolute(workspace)) throw new Error("Expected GitHub's isolated workspace");
const output = path.join(workspace, "proof-public");
await fs.mkdir(output, { recursive: true });
const rows = [];
for (const lane of ["baseline", "containment", "upgrade"]) {
  const dir = path.join(workspace, "proof", lane);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") { rows.push({ lane, outcome: "not-run" }); continue; } throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(dir, entry.name, "receipt.json");
    let raw;
    try { raw = await fs.readFile(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const receipt = JSON.parse(raw);
    const pairs = [[receipt.root, "<run-root>"], [receipt.repo, "<candidate-or-baseline>"], [receipt.nodeExecutable, "<node-executable>"], [workspace, "<github-workspace>"]].sort((a, b) => b[0].length - a[0].length);
    function redact(value) {
      if (typeof value === "string") { for (const [from, to] of pairs) value = value.split(from).join(to); return value; }
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
      return value;
    }
    const projection = { redacted: true, rawReceiptSha256: createHash("sha256").update(raw).digest("hex"), notice: "Synthetic owner-boundary evidence; local runner paths replaced. No raw configuration, transcript or application database is published.", receipt: redact(receipt) };
    await fs.writeFile(path.join(output, `${lane}-${entry.name}.json`), JSON.stringify(projection, null, 2) + "\n", { flag: "wx" });
    rows.push({ lane, gcLane: receipt.gcLane, outcome: receipt.outcome, head: receipt.sourceBefore?.head, seedHead: receipt.seedSourceBefore?.head, checks: receipt.results?.checks.map(({ name, pass }) => ({ name, pass })) });
  }
}
const summary = "# PR111497 POSIX / upgrade observations\n\n```json\n" + JSON.stringify(rows, null, 2) + "\n```\n";
await fs.writeFile(path.join(output, "summary.md"), summary, { flag: "wx" });
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(JSON.stringify(rows));
