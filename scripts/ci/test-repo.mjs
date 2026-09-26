// Disposable git repos for the tdd-* integration tests. Not a test file itself.
//
// The fixture mirrors Optra's seed layout on purpose: `scripts/seed/*.ts` is
// guarded source and `scripts/seed/__tests__/*.test.ts` runs under the ROOT
// vitest (no config file), exactly like `bun run db:seed:test`. The scratch repo
// symlinks this repo's real node_modules, so vitest and jest resolve without an
// install and without network.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function write(root, rel, content) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// Base commit on `main`, then a `feature` branch checked out. `origin/main` is faked
// as a local ref so the scripts' default base resolves without a network remote.
export function makeRepo(baseFiles = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tdd-repo-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  // `node_modules` (no trailing slash) also matches the symlink below.
  write(root, ".gitignore", "node_modules\n");
  for (const [rel, content] of Object.entries(baseFiles)) write(root, rel, content);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "-q", "-b", "feature");
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
  return {
    root,
    commit(files, message = "change") {
      for (const [rel, content] of Object.entries(files)) {
        if (content === null) git(root, "rm", "-q", rel);
        else write(root, rel, content);
      }
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", message);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export const VAT_SOURCE = "scripts/seed/vat.ts";
export const VAT_TEST = "scripts/seed/__tests__/vat.test.ts";

// Buggy: 10% and accepts negatives. Fixed: 12% and rejects negatives.
export const VAT_BUGGY = "export const vat = (n: number): number => n / 10;\n";
export const VAT_FIXED = [
  "export const vat = (n: number): number => {",
  '  if (n < 0) throw new Error("negative amount");',
  "  return (n * 12) / 100;",
  "};",
  "",
].join("\n");
export const VAT_SPEC = [
  "import { expect, it } from 'vitest'",
  "import { vat } from '../vat'",
  "it('error: rejects negative amounts', () => { expect(() => vat(-1)).toThrow() })",
  "it('edge: zero gives zero', () => { expect(vat(0)).toBe(0) })",
  "it('happy: 12% of 100', () => { expect(vat(100)).toBe(12) })",
  "",
].join("\n");
