#!/usr/bin/env node
// Secretless POSIX containment and stable-baseline upgrade proof. Synthetic fixtures only.
// Derived from the published retention recorder; no production source is modified.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const self = fileURLToPath(import.meta.url);
const payload = "OpenClaw PR 111497 synthetic artifact";
const artifactDigest = hash(payload);
const clockOrigin = 1_700_000_000_000;
const scenarios = new Set(["lifecycle", "legacy-restore", "startup-release", "containment"]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
function artifactReferences(card) {
  return card?.metadata?.artifacts?.map(({ path, url }) => ({ path, url }));
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
async function json(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function exists(file) {
  try { await fs.stat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function command(program, args, options = {}) {
  return (await execFileAsync(program, args, { timeout: 45_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...options })).stdout.trim();
}
async function sourceIdentity(repo) {
  const options = { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" } };
  const git = (...args) => command("git", args, options);
  const status = await git("status", "--porcelain=v1", "--untracked-files=normal");
  const untracked = (await git("ls-files", "--others", "--exclude-standard", "-z")).split("\0").filter(Boolean);
  const untrackedHashes = [];
  for (const file of untracked) {
    const stat = await fs.lstat(path.join(repo, file));
    untrackedHashes.push([file, stat.isSymbolicLink() ? hash(await fs.readlink(path.join(repo, file))) : hash(await fs.readFile(path.join(repo, file)))]);
  }
  const inputs = {};
  for (const file of ["package.json", "pnpm-lock.yaml", "tsconfig.json", "scripts/tsx.mjs", "scripts/lib/tsx-cli-shim.mjs", "src/agents/worktrees/service.ts", "extensions/workboard/src/sqlite-store.ts", "extensions/workboard/src/store.ts", "extensions/workboard/src/dispatcher-workspace.ts", "extensions/workboard/src/change-events.ts"]) {
    inputs[file] = hash(await fs.readFile(path.join(repo, file)));
  }
  return {
    head: await git("rev-parse", "HEAD"), tree: await git("rev-parse", "HEAD^{tree}"), status,
    diffSha256: hash(await git("diff", "--binary", "HEAD", "--")), untrackedHashes, inputs,
    dependencyDirectory: await fs.realpath(path.join(repo, "node_modules")),
  };
}
function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--allow-dirty") { result.allowDirty = true; continue; }
    invariant(["--repo", "--expected-head", "--scenario", "--output-root", "--child", "--config", "--seed-repo", "--expected-seed-head", "--gc-lane"].includes(key), `Unknown argument: ${key}`);
    invariant(args[index + 1] && !args[index + 1].startsWith("--"), `Missing value for ${key}`);
    result[key.slice(2)] = args[++index];
  }
  return result;
}
async function isolatedEnvironment(root, repo) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (["path", "systemroot", "windir", "comspec", "pathext", "systemdrive", "number_of_processors", "processor_architecture"].includes(key.toLowerCase())) env[key] = value;
  }
  const home = path.join(root, "home");
  const temp = path.join(root, "temp");
  for (const dir of [home, temp, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) await fs.mkdir(dir, { recursive: true });
  const gitConfig = path.join(home, ".gitconfig");
  await fs.writeFile(gitConfig, "[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n", { flag: "wx" });
  return {
    ...env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"), XDG_DATA_HOME: path.join(home, ".local", "share"),
    TMP: temp, TEMP: temp, TMPDIR: temp, OPENCLAW_STATE_DIR: path.join(root, "state"),
    OPENCLAW_CONFIG_PATH: path.join(home, "no-production-config.json"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitConfig, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1",
    TSX_TSCONFIG_PATH: path.join(repo, "tsconfig.json"), TSX_DISABLE_CACHE: "1", NO_COLOR: "1",
  };
}
async function runChild(config, phase, env) {
  const stdout = await fs.open(path.join(config.root, `${phase}.stdout.log`), "wx");
  const stderr = await fs.open(path.join(config.root, `${phase}.stderr.log`), "wx");
  const childRepo = phase === "seed" && config.seedRepo ? config.seedRepo : config.repo;
  const child = spawn(process.execPath, ["--import", pathToFileURL(path.join(childRepo, "scripts", "tsx.mjs")).href, self, "--child", phase, "--config", path.join(config.root, "config.json")], {
    cwd: childRepo, env: { ...env, TSX_TSCONFIG_PATH: path.join(childRepo, "tsconfig.json") }, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let timedOut = false;
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: "child-start", phase, pid: child.pid, startedAt }));
  const killOwnedChild = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") console.error(error); }
    }
  };
  const onSignal = () => { timedOut = true; killOwnedChild(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const deadline = setTimeout(() => { timedOut = true; killOwnedChild(); }, config.scenario === "startup-release" ? 150_000 : 120_000);
  const heartbeat = setInterval(() => console.log(JSON.stringify({ event: "child-running", phase, pid: child.pid })), 15_000);
  try {
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    return { phase, pid: child.pid, startedAt, finishedAt: new Date().toISOString(), timedOut, ...outcome };
  } finally {
    clearTimeout(deadline); clearInterval(heartbeat);
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    await stdout.close(); await stderr.close();
  }
}
async function controller(options) {
  invariant(options.repo && /^[a-f0-9]{40}$/i.test(options["expected-head"] ?? ""), "Required: --repo <checkout> --expected-head <40-character SHA>");
  const scenario = options.scenario ?? "lifecycle";
  invariant(scenarios.has(scenario), `Unsupported scenario: ${scenario}`);
  const gcLane = options["gc-lane"] ?? "count";
  invariant(["idle", "count", "size"].includes(gcLane), "GC lane must be idle, count or size");
  invariant(scenario !== "containment" || process.platform !== "win32", "Containment scenario requires native POSIX symlink semantics");
  const [major, minor] = process.versions.node.split(".").map(Number);
  invariant((major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26, "Use supported Node 24.16+ (24.x) or Node 26.1+, not PATH Node 22");
  const repo = await fs.realpath(path.resolve(options.repo));
  const seedRepo = options["seed-repo"] ? await fs.realpath(path.resolve(options["seed-repo"])) : null;
  invariant(!seedRepo || (scenario === "lifecycle" && /^[a-f0-9]{40}$/i.test(options["expected-seed-head"] ?? "")), "Upgrade requires lifecycle and exact expected seed head");
  const outputRoot = path.resolve(options["output-root"] ?? path.dirname(self));
  invariant(!inside(repo, outputRoot) && repo !== outputRoot, "Evidence must be outside the tested checkout");
  await fs.mkdir(outputRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(await fs.realpath(outputRoot), `${scenario}-`));
  const receipt = { schemaVersion: 1, scenario, gcLane, root, repo, startedAt: new Date().toISOString(), node: process.version, nodeExecutable: process.execPath, driverSha256: hash(await fs.readFile(self)), outcome: "setup-error", sourceBefore: null, sourceAfter: null, children: [], results: null };
  try {
    receipt.sourceBefore = await sourceIdentity(repo);
    invariant(receipt.sourceBefore.head === options["expected-head"].toLowerCase(), "Input HEAD differs from --expected-head");
    invariant(options.allowDirty || receipt.sourceBefore.status === "", "Input checkout is dirty; explicitly use --allow-dirty only for recorded pre-commit validation");
    invariant(await exists(path.join(repo, "node_modules", "tsx", "package.json")), "Tested checkout must already have task-prepared tsx dependencies; recorder never installs or links them");
    if (seedRepo) {
      receipt.seedSourceBefore = await sourceIdentity(seedRepo);
      invariant(receipt.seedSourceBefore.head === options["expected-seed-head"].toLowerCase() && receipt.seedSourceBefore.status === "", "Seed checkout identity mismatch");
    }
    const env = await isolatedEnvironment(root, repo);
    receipt.gitVersion = await command("git", ["--version"], { env });
    const stat = await fs.statfs(root, { bigint: true });
    receipt.realDisk = { availableBytes: String(stat.bavail * stat.bsize), totalBytes: String(stat.blocks * stat.bsize), mocked: false };
    const config = { root, repo, seedRepo, scenario, gcLane, source: receipt.sourceBefore, clockOrigin, artifactDigest };
    await json(path.join(root, "config.json"), config);
    for (const phase of ["seed", "verify"]) {
      assert.deepEqual(await sourceIdentity(repo), receipt.sourceBefore, "Source changed before worker launch");
      const child = await runChild(config, phase, env);
      receipt.children.push(child);
      invariant(!child.timedOut && child.code === 0, `${phase} worker failed/timed out; this is setup/infrastructure failure, never behavioral RED; inspect its stderr/receipt`);
    }
    receipt.results = await readJson(path.join(root, "verify.result.json"));
    if (seedRepo) {
      receipt.seedSourceAfter = await sourceIdentity(seedRepo);
      assert.deepEqual(receipt.seedSourceAfter, receipt.seedSourceBefore, "Seed source changed during upgrade proof");
    }
    invariant(receipt.children[0].pid !== receipt.children[1].pid, "Proof must use two distinct worker processes");
    receipt.sourceAfter = await sourceIdentity(repo);
    assert.deepEqual(receipt.sourceAfter, receipt.sourceBefore, "Source changed while proof ran");
    receipt.outcome = receipt.results.checks.every((check) => check.pass) ? "green" : "red";
  } catch (error) {
    receipt.error = { name: error.name, message: error.message, stack: error.stack };
    try { receipt.sourceAfter = await sourceIdentity(repo); } catch { /* retain original failure */ }
  }
  receipt.finishedAt = new Date().toISOString();
  await json(path.join(root, "receipt.json"), receipt);
  console.log(JSON.stringify({ outcome: receipt.outcome, receipt: path.join(root, "receipt.json"), checks: receipt.results?.checks }));
  process.exitCode = receipt.outcome === "green" ? 0 : receipt.outcome === "red" ? 1 : 2;
}

async function worker(options) {
  const config = await readJson(options.config);
  if (options.child === "seed" && config.seedRepo) config.repo = config.seedRepo;
  invariant(["seed", "verify"].includes(options.child), "Invalid child phase");
  invariant(process.env.OPENCLAW_STATE_DIR === path.join(config.root, "state"), "Missing isolated environment");
  const load = (relative) => import(pathToFileURL(path.join(config.repo, relative)).href);
  const [{ ManagedWorktreeService, IDLE_GC_MS }, { createWorkboardSqliteStores }, { WorkboardStore }, { cleanupWorkboardCardWorktree }, { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase }] = await Promise.all([
    load("src/agents/worktrees/service.ts"), load("extensions/workboard/src/sqlite-store.ts"), load("extensions/workboard/src/store.ts"), load("extensions/workboard/src/dispatcher-workspace.ts"), load("src/state/openclaw-state-db.ts"),
  ]);
  let now = config.clockOrigin;
  const service = new ManagedWorktreeService({ env: process.env, now: () => now });
  const hasRetention = typeof service.resolveRetentionTargetByPath === "function" && typeof service.setRetentionClaim === "function";
  const result = { phase: options.child, scenario: config.scenario, pid: process.pid, hasRetention, checks: [], observations: [] };
  const observe = (event, detail = {}) => {
    const entry = { event, at: new Date().toISOString(), ...detail };
    result.observations.push(entry); console.log(JSON.stringify(entry));
  };
  const check = (name, pass, detail = {}) => { result.checks.push({ name, pass: Boolean(pass), ...detail }); observe("check", result.checks.at(-1)); };
  let failReleases = options.child === "seed" && config.scenario === "startup-release";
  let failFirstRelease = options.child === "verify" && config.scenario === "startup-release";
  let releaseAttempts = 0;
  let successfulReleases = 0;
  const retention = hasRetention ? {
    resolveRetentionTarget: async (params) => service.resolveRetentionTargetByPath(params.path, { ownerKind: params.ownerKind, ownerId: params.ownerId }),
    setRetentionClaim: async (params) => {
      if (!params.active) {
        releaseAttempts++;
        if (failReleases || failFirstRelease) {
          failFirstRelease = false;
          observe("injected-transient-release-failure", { releaseAttempts, worktreeId: params.worktreeId });
          throw new Error("PR111497 proof: one owner-boundary retention release is temporarily unavailable");
        }
      }
      const applied = await service.setRetentionClaim(params.worktreeId, { ownerKind: params.ownerKind, ownerId: params.ownerId }, { claimId: params.claimId, active: params.active });
      if (!params.active && applied) successfulReleases++;
      return applied;
    },
  } : undefined;
  if (config.scenario !== "lifecycle") invariant(hasRetention, `${config.scenario} requires retention owner APIs; unavailable is unsupported setup, not RED`);
  // Legacy seeding deliberately omits retention integration, using canonical pre-enrollment store APIs.
  const sqlite = createWorkboardSqliteStores({ env: process.env, ...(options.child === "seed" && config.scenario === "legacy-restore" ? {} : retention ? { worktrees: retention } : {}) });
  const store = new WorkboardStore(sqlite.cards, { boards: sqlite.boards, subscriptions: sqlite.subscriptions, attachments: sqlite.attachments, dataVersion: sqlite.dataVersion });
  const cleanupRuntime = {
    release: async (params) => service.releaseByPath(params.path),
    removeIfLossless: async (params) => service.removeIfLosslessByPath(params.path, { ownerKind: params.ownerKind, ownerId: params.ownerId }),
  };
  const git = (cwd, ...args) => command("git", ["-C", cwd, ...args], { env: process.env });
  const artifactState = async (fixture) => {
    let actualHash = null;
    try { actualHash = hash(await fs.readFile(fixture.artifact)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const card = await store.get(fixture.cardId);
    return { artifactExists: actualHash !== null, artifactSha256: actualHash, expectedSha256: config.artifactDigest, worktreeExists: await exists(fixture.worktree.path), cardExists: Boolean(card), artifacts: card?.metadata?.artifacts, workspace: card?.metadata?.automation?.workspace };
  };
  const checkRetained = async (name, fixture, gc) => {
    const state = await artifactState(fixture);
    const referenced = state.artifacts?.some((artifact) => artifact.path === fixture.artifactRelative) === true;
    check(name, state.artifactSha256 === config.artifactDigest && state.worktreeExists && referenced && (!gc || !gc.removed.includes(fixture.worktree.id)), { ...state, gc });
  };
  const readSchemas = async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const core = openOpenClawStateDatabase({ env: process.env }).db;
    const board = new DatabaseSync(path.join(process.env.OPENCLAW_STATE_DIR, "plugins", "workboard", "workboard.sqlite"), { readOnly: true });
    const inspect = (db) => ({
      userVersion: db.prepare("PRAGMA user_version").get().user_version,
      tables: db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('worktree_retention_claims','workboard_artifact_retention') ORDER BY name").all().map((row) => row.name),
    });
    try { return { core: inspect(core), workboard: inspect(board) }; } finally { board.close(); }
  };
  let changeEvents;
  try {
    if (options.child === "seed") {
      let repo = path.join(config.root, "fixture-repo");
      await fs.mkdir(repo);
      await git(repo, "init", "-b", "main");
      await git(repo, "config", "user.name", "OpenClaw Synthetic Proof");
      await git(repo, "config", "user.email", "proof@example.invalid");
      await fs.writeFile(path.join(repo, "README.md"), "synthetic fixture\n", { flag: "wx" });
      // A trailing slash excludes directories but not the outbound symlink named dist.
      await fs.writeFile(path.join(repo, ".gitignore"), "/dist\n", { flag: "wx" });
      await git(repo, "add", "README.md", ".gitignore");
      await git(repo, "commit", "-m", "Create synthetic artifact retention fixture");
      const remote = path.join(config.root, "fixture-remote.git");
      await command("git", ["clone", "--bare", repo, remote], { env: process.env });
      await git(repo, "remote", "add", "origin", remote);
      await git(repo, "push", "-u", "origin", "main");
      repo = await fs.realpath(repo);
      const card = await store.create({ title: `PR111497 ${config.scenario}`, status: "done", runId: `synthetic-${config.scenario}` });
      const worktree = await service.create({ repoRoot: repo, name: `proof-${config.scenario}`, ownerKind: "workboard", ownerId: card.id });
      invariant(inside(await fs.realpath(config.root), await fs.realpath(worktree.path)), "Refusing worktree outside this proof run");
      await service.acquire(worktree.id);
      await store.update(card.id, { workspace: { kind: "worktree", path: worktree.path, branch: worktree.branch, sourcePath: repo, sourceBranch: "main" }, workspaceAccess: { unrestricted: true } });
      const artifactRelative = config.scenario === "legacy-restore" ? "report.txt" : "dist/report.txt";
      const artifact = path.join(worktree.path, artifactRelative);
      await fs.mkdir(path.dirname(artifact), { recursive: true });
      await fs.writeFile(artifact, payload, { flag: "wx" });
      let artifactReference = artifactRelative;
      if (config.scenario === "containment") {
        const alias = path.join(config.root, "inbound-alias");
        await fs.symlink(worktree.path, alias, "dir");
        invariant((await fs.lstat(alias)).isSymbolicLink(), "Positive alias is not a native symlink");
        artifactReference = path.join(alias, artifactRelative);
        observe("native-posix-inbound-alias", { alias, target: await fs.readlink(alias), canonicalArtifact: await fs.realpath(artifact) });
      }
      await store.addArtifact(card.id, { path: artifactReference });
      const fixture = { repo, cardId: card.id, worktree, artifact, artifactRelative: artifactReference, seedPid: process.pid };
      if (config.seedRepo) {
        fixture.seedSchemas = await readSchemas();
        fixture.cardBeforeUpgrade = await store.get(card.id);
      }
      if (config.scenario === "containment") {
        fixture.controls = [];
        const outsideDir = path.join(config.root, "outside-artifacts");
        await fs.mkdir(outsideDir);
        const outsideFile = path.join(outsideDir, "outside.txt");
        await fs.writeFile(outsideFile, payload, { flag: "wx" });
        for (const kind of ["url-only", "outside-path", "outbound-symlink"]) {
          const controlCard = await store.create({ title: `PR111497 ${kind}`, status: "done", runId: `synthetic-${kind}` });
          const controlTree = await service.create({ repoRoot: repo, name: `proof-${kind}`, ownerKind: "workboard", ownerId: controlCard.id });
          invariant(inside(config.root, await fs.realpath(controlTree.path)), "Control worktree escaped fixture");
          await service.acquire(controlTree.id);
          await store.update(controlCard.id, { workspace: { kind: "worktree", path: controlTree.path, branch: controlTree.branch, sourcePath: repo, sourceBranch: "main" }, workspaceAccess: { unrestricted: true } });
          let reference = { url: "https://example.invalid/report.txt" };
          if (kind === "outside-path") reference = { path: outsideFile };
          if (kind === "outbound-symlink") {
            const alias = path.join(controlTree.path, "dist");
            await fs.symlink(outsideDir, alias, "dir");
            invariant((await fs.lstat(alias)).isSymbolicLink(), "Negative alias is not a native symlink");
            reference = { path: "dist/outside.txt" };
            observe("native-posix-outbound-alias", { alias, target: await fs.readlink(alias), canonicalArtifact: await fs.realpath(path.join(alias, "outside.txt")) });
          }
          await store.addArtifact(controlCard.id, reference);
          const persisted = await store.get(controlCard.id);
          assert.deepEqual(artifactReferences(persisted), [{ path: reference.path, url: reference.url }], "Control reference must actually be stored");
          fixture.controls.push({ kind, cardId: controlCard.id, worktree: controlTree, outsideFile, reference, artifacts: persisted.metadata.artifacts });
        }
      }
      invariant(hash(await fs.readFile(artifact)) === artifactDigest, "Seed artifact bytes differ");
      const gitStatus = await git(worktree.path, "status", "--porcelain=v1", "--untracked-files=all");
      observe("seed-persisted", { fixture, gitStatus, state: await artifactState(fixture) });
      if (config.scenario !== "legacy-restore") {
        invariant(gitStatus === "", "Ignored artifact fixture must be Git-clean");
        observe("git-check-ignore", { output: await git(worktree.path, "check-ignore", "--", artifactRelative) });
      }
      if (config.scenario === "legacy-restore") {
        await service.release(worktree.id);
        const removed = await service.remove({ id: worktree.id, reason: "proof-operator-remove-before-first-enrollment" });
        invariant(!(await exists(worktree.path)), "Legacy preparation did not actually remove checkout");
        observe("legacy-explicit-removal", { removed });
      }
      if (config.scenario === "startup-release") {
        invariant(await sqlite.cards.delete(card.id), "Seed deletion did not commit");
        invariant((await store.get(card.id)) === undefined, "Deleted card remains visible");
        invariant(releaseAttempts > 0, "Release failure was not exercised");
        await service.release(worktree.id);
        const gc = await service.gc({ limits: { maxCount: 0 } });
        invariant(!gc.removed.includes(worktree.id) && await exists(artifact), "Pending release did not retain real artifact");
        observe("durable-release-pending", { releaseAttempts, gc });
      }
      await json(path.join(config.root, "fixture.json"), fixture);
    } else {
      const fixture = await readJson(path.join(config.root, "fixture.json"));
      invariant(fixture.seedPid !== process.pid, "No actual process restart");
      invariant(inside(config.root, fixture.worktree.path) && inside(fixture.worktree.path, fixture.artifact), "Fixture paths escaped task scope");
      observe("reopened-after-process-exit", { seedPid: fixture.seedPid, verifyPid: process.pid, state: await artifactState(fixture) });
      if (config.seedRepo) {
        const { createWorkboardChangeEventService } = await load("extensions/workboard/src/change-events.ts");
        const startup = createWorkboardChangeEventService(store);
        await startup.start({ config: {}, stateDir: process.env.OPENCLAW_STATE_DIR, logger: Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (message) => observe(`upgrade-${level}`, { message: String(message) })])) });
        startup.stop();
        const afterSchemas = await readSchemas();
        const cardAfterUpgrade = await store.get(fixture.cardId);
        check("stable-baseline-database-upgrade-preserves-card-and-adds-retention", fixture.seedSchemas.core.tables.length === 0 && fixture.seedSchemas.workboard.tables.length === 0 && afterSchemas.core.tables.includes("worktree_retention_claims") && afterSchemas.workboard.tables.includes("workboard_artifact_retention") && afterSchemas.core.userVersion === fixture.seedSchemas.core.userVersion && afterSchemas.workboard.userVersion === fixture.seedSchemas.workboard.userVersion && JSON.stringify(cardAfterUpgrade) === JSON.stringify(fixture.cardBeforeUpgrade), { before: fixture.seedSchemas, after: afterSchemas, cardPreserved: JSON.stringify(cardAfterUpgrade) === JSON.stringify(fixture.cardBeforeUpgrade) });
      }
      for (const control of fixture.controls ?? []) {
        const beforeCleanup = await store.get(control.cardId);
        const gitStatusBeforeCleanup = await git(control.worktree.path, "status", "--porcelain=v1", "--untracked-files=all");
        invariant(gitStatusBeforeCleanup === "", "Negative-control fixture must be Git-clean; dirty preservation is not artifact retention");
        const expected = [{ path: control.reference.path, url: control.reference.url }];
        const referenceWasPresent = isDeepStrictEqual(artifactReferences(beforeCleanup), expected) && isDeepStrictEqual(beforeCleanup?.metadata?.artifacts, control.artifacts);
        await cleanupWorkboardCardWorktree({ store, worktrees: cleanupRuntime, card: beforeCleanup });
        const afterCleanup = await store.get(control.cardId);
        const outsideHash = hash(await fs.readFile(control.outsideFile));
        check(`posix-${control.kind}-does-not-pin-unrelated-checkout`, referenceWasPresent && isDeepStrictEqual(afterCleanup?.metadata?.artifacts, control.artifacts) && !(await exists(control.worktree.path)) && outsideHash === artifactDigest, { gitStatusBeforeCleanup, checkoutRemoved: !(await exists(control.worktree.path)), outsideSha256: outsideHash, expectedReference: control.reference, referenceWasPresent, artifactsBefore: beforeCleanup?.metadata?.artifacts, artifactsAfter: afterCleanup?.metadata?.artifacts });
      }
      if (config.scenario === "legacy-restore") {
        invariant(typeof store.reconcileArtifactRetention === "function", "Legacy reconciliation entry unavailable");
        await store.reconcileArtifactRetention();
        observe("first-enrollment-while-removed", { state: await artifactState(fixture) });
        const restored = await service.restore({ id: fixture.worktree.id });
        invariant(restored.id === fixture.worktree.id && hash(await fs.readFile(fixture.artifact)) === artifactDigest, "Git snapshot restore did not recover exact artifact");
        // No manual re-enrollment after restore: claims must already protect this generation.
        await checkRetained("legacy-first-enrollment-then-restore-count-gc", fixture, await service.gc({ limits: { maxCount: 0 } }));
      } else if (config.scenario === "lifecycle" || config.scenario === "containment") {
        invariant(hash(await fs.readFile(fixture.artifact)) === artifactDigest, "Artifact did not survive seed process closure");
        await cleanupWorkboardCardWorktree({ store, worktrees: cleanupRuntime, card: await store.get(fixture.cardId) });
        await checkRetained("real-run-end-cleanup", fixture);
      } else {
        const { createWorkboardChangeEventService } = await load("extensions/workboard/src/change-events.ts");
        changeEvents = createWorkboardChangeEventService(store);
        const logger = Object.fromEntries(["debug", "info", "warn", "error"].map((level) => [level, (message) => observe(`service-${level}`, { message: String(message) })]));
        const started = Date.now();
        try { await changeEvents.start({ config: {}, stateDir: process.env.OPENCLAW_STATE_DIR, logger }); }
        catch (error) { observe("startup-rejected", { message: error.message }); }
        invariant(releaseAttempts === 1, "Expected exactly one injected release failure during service startup");
        // Real scheduler and real time: never call start/reconcile again to manufacture recovery.
        while (successfulReleases === 0 && Date.now() - started < 75_000) await new Promise((resolve) => setTimeout(resolve, 250));
        changeEvents.stop();
        const gc = await service.gc({ limits: { maxCount: 0 } });
        check("startup-release-failure-auto-retry", successfulReleases > 0 && releaseAttempts >= 2 && gc.removed.includes(fixture.worktree.id) && !(await exists(fixture.artifact)), { elapsedMs: Date.now() - started, releaseAttempts, successfulReleases, gc });
      }
      if (config.scenario !== "startup-release") {
        if (await exists(fixture.artifact)) {
          // One fresh fixture per lane: count/size must not be preempted by idle removal.
          if (config.gcLane === "idle") now += IDLE_GC_MS + 1;
          const gcParams = { limits: config.gcLane === "idle" ? {} : config.gcLane === "count" ? { maxCount: 0 } : { maxTotalSizeBytes: 1 } };
          observe("isolated-gc-lane", { lane: config.gcLane, now, clockOrigin: config.clockOrigin, gcParams });
          await checkRetained(`${config.gcLane}-gc`, fixture, await service.gc(gcParams));
          if (await exists(fixture.artifact)) {
            const card = await store.get(fixture.cardId);
            await store.update(fixture.cardId, { metadata: { ...card.metadata, artifacts: [{ url: "https://example.invalid/report.txt" }] } });
            const externalized = await store.get(fixture.cardId);
            const gc = await service.gc(gcParams);
            const afterGc = await store.get(fixture.cardId);
            const expected = [{ path: undefined, url: "https://example.invalid/report.txt" }];
            check(`externalize-inverse-allows-real-${config.gcLane}-gc`, gc.removed.includes(fixture.worktree.id) && !(await exists(fixture.worktree.path)) && isDeepStrictEqual(artifactReferences(externalized), expected) && isDeepStrictEqual(artifactReferences(afterGc), expected), { lane: config.gcLane, gcParams, gc, artifacts: externalized?.metadata?.artifacts, artifactsAfterGc: afterGc?.metadata?.artifacts, state: await artifactState(fixture) });
          }
        } else {
          observe("downstream-checks-not-applicable-after-real-artifact-loss", { skipped: [`${config.gcLane}-gc`, "externalize-inverse"] });
        }
      }
    }
  } finally {
    changeEvents?.stop();
    sqlite.close();
    closeOpenClawStateDatabaseForTest();
  }
  await json(path.join(config.root, `${options.child}.result.json`), result);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.child) await worker(options); else await controller(options);
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 2;
}
