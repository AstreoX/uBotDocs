import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BOT_EMAIL, syncBranch } from "../scripts/sync-branch.mjs";
import { removeDir } from "./helpers.mjs";

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Maintainer", "-c", "user.email=maintainer@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (dir, rel, text) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const BRANCH = "bot/sync-packages";
const PATHS = ["data/index.json", "data/api"];

/** A bare "GitHub" and a checkout of its main branch, which holds data/ and one file the sync never touches. */
function setup() {
  const base = mkdtempSync(join(tmpdir(), "ubot-sync-branch-"));
  const remote = join(base, "remote.git");
  const work = join(base, "work");
  git(base, "init", "--quiet", "--bare", "-b", "main", remote);
  git(base, "init", "--quiet", "-b", "main", work);
  write(work, "data/index.json", "{ \"v\": 1 }\n");
  write(work, "data/api/A.json", "{ \"a\": 1 }\n");
  write(work, "README.md", "docs\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "main");
  git(work, "push", "--quiet", remote, "main");
  return { base, remote, work };
}
const sync = (work, remote, extra = {}) => syncBranch({ cwd: work, branch: BRANCH, remote, paths: PATHS, message: "chore(data): sync", ...extra });
const remoteTip = (remote) => git(remote, "rev-parse", `refs/heads/${BRANCH}`);
/** The data a sync run would bring, applied to the working tree of main. */
function changeData(work, v) {
  git(work, "switch", "--quiet", "main");
  write(work, "data/index.json", `{ "v": ${v} }\n`);
  write(work, "data/api/A.json", `{ "a": ${v} }\n`);
}

test("sync-branch: first push, then no push while the data is the same, then a push when it changes", () => {
  const { base, remote, work } = setup();
  try {
    changeData(work, 2);
    const first = sync(work, remote);
    assert.equal(first.result, "pushed");
    const tip = remoteTip(remote);
    assert.equal(tip, first.sha);
    assert.equal(git(remote, "log", "-1", "--format=%ae", tip), BOT_EMAIL, "committed as the bot");
    assert.deepEqual(git(remote, "diff", "--name-only", "main", tip).split("\n").sort(), ["data/api/A.json", "data/index.json"], "only the synced paths");

    // the next scheduled run finds the same data again: a new commit would be identical in content, so nothing is pushed
    changeData(work, 2);
    const same = sync(work, remote);
    assert.equal(same.result, "unchanged");
    assert.equal(remoteTip(remote), tip, "the branch keeps its commit");

    // main moved on without touching data/: the branch still holds the same data
    git(work, "switch", "--quiet", "main");
    write(work, "README.md", "docs, new page\n");
    git(work, "commit", "--quiet", "-am", "a page");
    changeData(work, 2);
    assert.equal(sync(work, remote).result, "unchanged");
    assert.equal(remoteTip(remote), tip);

    // a new release changes the data: the branch is replaced by one commit on top of main
    changeData(work, 3);
    const next = sync(work, remote);
    assert.equal(next.result, "pushed");
    assert.notEqual(remoteTip(remote), tip);
    assert.equal(remoteTip(remote), next.sha);
  } finally {
    removeDir(base);
  }
});

test("sync-branch: a commit by a person on the branch is never overwritten", () => {
  const { base, remote, work } = setup();
  try {
    changeData(work, 2);
    assert.equal(sync(work, remote).result, "pushed");

    // a maintainer fixes a summary on the pull request branch
    const fix = join(base, "fix");
    git(base, "clone", "--quiet", "-b", BRANCH, remote, fix);
    write(fix, "data/zh/Fix.yaml", "fixed: true\n");
    git(fix, "add", ".");
    git(fix, "commit", "--quiet", "-m", "fix a summary");
    git(fix, "push", "--quiet", "origin", BRANCH);
    const theirs = remoteTip(remote);

    // the data changes again, but the person's commit stays
    changeData(work, 3);
    const out = sync(work, remote);
    assert.equal(out.result, "foreign");
    assert.equal(out.author, "maintainer@example.com");
    assert.equal(remoteTip(remote), theirs);
    assert.equal(git(work, "branch", "--show-current"), "main", "the working tree is left alone");
  } finally {
    removeDir(base);
  }
});

test("sync-branch: nothing to commit when the data equals main", () => {
  const { base, remote, work } = setup();
  try {
    git(work, "switch", "--quiet", "main");
    assert.equal(sync(work, remote).result, "none");
    assert.equal(git(work, "ls-remote", "--heads", remote, `refs/heads/${BRANCH}`), "", "no branch was created");
  } finally {
    removeDir(base);
  }
});
