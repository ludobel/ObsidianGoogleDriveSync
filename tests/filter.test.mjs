import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const outfile = path.join(tmpdir(), `obsidian-google-sync-filter-${Date.now()}.mjs`);
await build({ entryPoints: ["src/filter.ts"], outfile, bundle: true, platform: "node", format: "esm" });

const { SyncFilter, matchesIgnorePatterns, parseExtensionList, effectiveMaxFileSizeMB, HARD_MAX_FILE_SIZE_MB } =
  await import(`${pathToFileURL(outfile).href}?${Date.now()}`);

const MB = 1024 * 1024;
const make = (settings) => new SyncFilter(() => ({ ignoredPaths: "", excludedExtensions: "", maxFileSizeMB: 500, ...settings }));

test("legacy folder prefix and exact path behave as before", () => {
  assert.equal(matchesIgnorePatterns(".smart-env/multi/a.ajson", [".smart-env/"]), true);
  assert.equal(matchesIgnorePatterns(".smart-envX/a", [".smart-env/"]), false);
  assert.equal(matchesIgnorePatterns(".copilot/index.json", [".copilot"]), true);
  assert.equal(matchesIgnorePatterns("notes/.copilot", [".copilot"]), false);
});

test("glob without slash matches the file name anywhere, case-insensitively", () => {
  assert.equal(matchesIgnorePatterns("Z3 - Formation/Cours/Video 1.MP4", ["*.mp4"]), true);
  assert.equal(matchesIgnorePatterns("Z3 - Formation/Cours/Video 1.mp4.md", ["*.mp4"]), false);
  assert.equal(matchesIgnorePatterns(".obsidian/workspace-PCHome-2.json", [".obsidian/workspace*.json"]), true);
});

test("double-star globs match nested folders", () => {
  assert.equal(matchesIgnorePatterns("a/b/videos/x.mp4", ["**/videos/**"]), true);
  assert.equal(matchesIgnorePatterns("videos/x.mp4", ["**/videos/**"]), true);
  assert.equal(matchesIgnorePatterns("Archives/2020/x.md", ["Archives/**"]), true);
  assert.equal(matchesIgnorePatterns("Notes/Archives/x.md", ["Archives/**"]), false);
});

test("extension list parsing accepts commas, spaces, dots and stars", () => {
  assert.deepEqual([...parseExtensionList("mp4, .m4a; *.MOV  mkv")].sort(), ["m4a", "mkv", "mov", "mp4"]);
});

test("excluded file types are rejected, others accepted", () => {
  const filter = make({ excludedExtensions: "mp4, m4a" });
  assert.equal(filter.exclusionReason("Cours/Seance 1.MP4", 10 * MB), "type");
  assert.equal(filter.exclusionReason("Cours/Seance 1.pptx", 10 * MB), null);
  assert.equal(filter.exclusionReason(".mp4", 10), null, "dotfile without extension is not a type match");
});

test("size limit is configurable and capped below 2 GiB", () => {
  assert.equal(make({ maxFileSizeMB: 200 }).exclusionReason("big.pptx", 250 * MB), "size");
  assert.equal(make({ maxFileSizeMB: 200 }).exclusionReason("ok.pptx", 150 * MB), null);
  assert.equal(effectiveMaxFileSizeMB(0), HARD_MAX_FILE_SIZE_MB);
  assert.equal(effectiveMaxFileSizeMB(99999), HARD_MAX_FILE_SIZE_MB);
  assert.equal(make({ maxFileSizeMB: 0 }).exclusionReason("huge.mp4", 2441243574), "size");
  assert.equal(make({}).isSizeExcluded(undefined), false);
});

test("path rules take precedence over size in the reported reason", () => {
  const filter = make({ ignoredPaths: "Archives/", maxFileSizeMB: 1 });
  assert.equal(filter.exclusionReason("Archives/big.pdf", 50 * MB), "path");
});

test("settings changes are picked up without recreating the filter", () => {
  const settings = { ignoredPaths: "", excludedExtensions: "", maxFileSizeMB: 500 };
  const filter = new SyncFilter(() => settings);
  assert.equal(filter.isPathExcluded("a.mp4"), false);
  settings.excludedExtensions = "mp4";
  assert.equal(filter.isPathExcluded("a.mp4"), true);
});
