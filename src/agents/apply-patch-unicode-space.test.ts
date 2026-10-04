import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { applyUpdateHunk, type UpdateFileChunk } from "./apply-patch-update.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function applyChunks(initial: string, chunks: UpdateFileChunk[]): Promise<string> {
  const dir = tempDirs.make("openclaw-patch-unicode-space-");
  const file = path.join(dir, "source.txt");
  await fs.writeFile(file, initial, "utf8");
  try {
    return await applyUpdateHunk(file, chunks);
  } finally {
    // The owner reads the fixture and returns content; it does not write the file.
    expect(await fs.readFile(file)).toEqual(Buffer.from(initial, "utf8"));
  }
}

function contextChunk(context = "# wait 30 seconds", replacement = "new value"): UpdateFileChunk {
  return {
    oldLines: [context, "old value"],
    newLines: [context, replacement],
    contextOldIndexes: [0, undefined],
    isEndOfFile: false,
  };
}

const quadSpaces = [
  { label: "U+2000 en quad", space: "\u2000" },
  { label: "U+2001 em quad", space: "\u2001" },
];

describe("applyUpdateHunk Unicode space matching", () => {
  it.each(quadSpaces)(
    "matches ASCII context against $label and preserves source bytes",
    async ({ space }) => {
      const initial = `# wait${space}30 seconds\nold value\n`;
      const expected = `# wait${space}30 seconds\nnew value\n`;
      const actual = await applyChunks(initial, [contextChunk()]);
      expect(Buffer.from(actual, "utf8")).toEqual(Buffer.from(expected, "utf8"));
    },
  );

  it.each(quadSpaces)("matches $label context against an ASCII source", async ({ space }) => {
    expect(
      await applyChunks("# wait 30 seconds\nold value\n", [
        contextChunk(`# wait${space}30 seconds`),
      ]),
    ).toBe("# wait 30 seconds\nnew value\n");
  });

  it.each(quadSpaces)(
    "matches an ASCII change-context anchor against $label",
    async ({ space }) => {
      expect(
        await applyChunks(`# wait${space}30 seconds\nold value\n`, [
          {
            changeContext: "# wait 30 seconds",
            oldLines: ["old value"],
            newLines: ["new value"],
            contextOldIndexes: [undefined],
            isEndOfFile: false,
          },
        ]),
      ).toBe(`# wait${space}30 seconds\nnew value\n`);
    },
  );

  it.each(
    quadSpaces.flatMap(({ label, space }) => [
      {
        label: `${label} CRLF`,
        initial: `# wait${space}30 seconds\r\nold value\r\n`,
        expected: `# wait${space}30 seconds\r\nnew value\r\n`,
      },
      {
        label: `${label} CR`,
        initial: `# wait${space}30 seconds\rold value\r`,
        expected: `# wait${space}30 seconds\rnew value\r`,
      },
      {
        label: `${label} mixed endings`,
        initial: `before\r\n# wait${space}30 seconds\nold value\r\ntail\r`,
        expected: `before\r\n# wait${space}30 seconds\nnew value\r\ntail\r`,
      },
      {
        label: `${label} BOM`,
        initial: `\uFEFF# wait${space}30 seconds\nold value\n`,
        expected: `\uFEFF# wait${space}30 seconds\nnew value\n`,
      },
      {
        label: `${label} missing final newline`,
        initial: `# wait${space}30 seconds\nold value`,
        expected: `# wait${space}30 seconds\nnew value`,
      },
    ]),
  )("preserves exact bytes for $label", async ({ initial, expected }) => {
    expect(Buffer.from(await applyChunks(initial, [contextChunk()]), "utf8")).toEqual(
      Buffer.from(expected, "utf8"),
    );
  });

  it.each([
    { label: "ASCII space", space: " " },
    { label: "U+00A0", space: "\u00A0" },
    { label: "U+2002", space: "\u2002" },
    { label: "U+200A", space: "\u200A" },
    { label: "U+202F", space: "\u202F" },
    { label: "U+205F", space: "\u205F" },
    { label: "U+3000", space: "\u3000" },
  ])("retains existing matching for $label", async ({ space }) => {
    expect(await applyChunks(`# wait${space}30 seconds\nold value\n`, [contextChunk()])).toBe(
      `# wait${space}30 seconds\nnew value\n`,
    );
  });

  it("keeps replacement whitespace and punctuation literal", async () => {
    const replacement = "\tnew\u2000value\u2001−‘quoted’\u2002\u00A0  ";
    expect(
      await applyChunks("# wait\u200230 seconds\r\nold value\r\n", [
        contextChunk(undefined, replacement),
      ]),
    ).toBe(`# wait\u200230 seconds\r\n${replacement}\r\n`);
  });

  it("prefers an exact match over a Unicode-space fallback", async () => {
    const initial = "# wait\u200030 seconds\nold value\n# wait 30 seconds\nold value\n";
    expect(await applyChunks(initial, [contextChunk()])).toBe(
      "# wait\u200030 seconds\nold value\n# wait 30 seconds\nnew value\n",
    );
  });

  it("retains ambiguous-match rejection for existing spaces", async () => {
    await expect(
      applyChunks("# wait\u200230 seconds\nold value\n# wait\u200230 seconds\nold value\n", [
        contextChunk(),
      ]),
    ).rejects.toThrow("Found 2 occurrences");
  });

  it("rejects ambiguous quad-space fallback matches", async () => {
    await expect(
      applyChunks("# wait\u200030 seconds\nold value\n# wait\u200130 seconds\nold value\n", [
        contextChunk(),
      ]),
    ).rejects.toThrow("Found 2 occurrences");
  });

  it.each([
    { label: "zero-width space", space: "\u200B" },
    { label: "interior tab", space: "\t" },
  ])("does not broaden matching to $label", async ({ space }) => {
    await expect(
      applyChunks(`# wait${space}30 seconds\nold value\n`, [contextChunk()]),
    ).rejects.toThrow("Failed to find expected lines");
  });
});
