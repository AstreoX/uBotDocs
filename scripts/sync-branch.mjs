#!/usr/bin/env node
// Publishes what a sync run changed on one pull request branch, without rewriting what is already there.
// The sync-packages workflow calls it instead of a bare `git push --force`:
//
//   node scripts/sync-branch.mjs --branch bot/sync-packages --remote <url> --message <text> -- data/index.json data/api
//
// It commits the given paths (changed in the working tree) on the branch and then, depending on what
// the remote branch holds:
//
//   pushed     the branch does not exist or its data differs: pushed (--force-with-lease against the sha
//              just looked at, so a push that lands in between is never overwritten)
//   unchanged  the remote branch already holds exactly this data: nothing is pushed, so the pull request
//              keeps its history and review state instead of getting a new commit every day
//   foreign    the remote branch's newest commit is not the bot's (a maintainer fixed something on it):
//              nothing is pushed or overwritten; merge or close the pull request, the next run starts fresh
//   none       nothing to commit
//
// The result goes to stdout and, in GitHub Actions, to $GITHUB_OUTPUT (result=...). A token in GH_TOKEN
// is handed to git through the environment, never on a command line.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BOT_NAME = "github-actions[bot]";
export const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/**
 * Commits `paths` on `branch` in the repository at `cwd` and pushes it to `remote` unless it already holds
 * the same data. Returns { result: "pushed" | "unchanged" | "foreign" | "none", sha, remoteSha, author }.
 */
export function syncBranch({ cwd = process.cwd(), branch, remote, paths, message, name = BOT_NAME, email = BOT_EMAIL, token = "" }) {
  if (!branch || !remote || !message || !paths?.length) throw new Error("syncBranch needs a branch, a remote, a message and paths");
  const env = { ...process.env };
  if (token) {
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${header.split(" ").pop()}`);
    Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraheader", GIT_CONFIG_VALUE_0: header });
  }
  const git = (args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const objectOf = (sha, path) => {
    try {
      return git(["rev-parse", "--verify", "--quiet", `${sha}:${path}`]).trim();
    } catch {
      return ""; // not in that commit
    }
  };

  const ref = `refs/heads/${branch}`;
  const listed = git(["ls-remote", "--heads", remote, ref]).trim();
  const remoteSha = listed ? listed.split(/\s+/)[0] : "";
  if (remoteSha) {
    git(["fetch", "--no-tags", "--depth=1", remote, ref]);
    const author = git(["log", "-1", "--format=%ae", remoteSha]).trim();
    if (author !== email) return { result: "foreign", remoteSha, author };
  }

  git(["switch", "-C", branch]);
  git(["add", "--", ...paths]);
  if (!git(["diff", "--cached", "--name-only"]).trim()) return { result: "none", remoteSha };
  git(["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "--quiet", "-m", message]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  if (remoteSha && paths.every((p) => objectOf(sha, p) === objectOf(remoteSha, p))) return { result: "unchanged", sha, remoteSha };
  git(["push", "--quiet", ...(remoteSha ? [`--force-with-lease=${ref}:${remoteSha}`] : []), remote, `HEAD:${ref}`]);
  return { result: "pushed", sha, remoteSha };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const dashes = argv.indexOf("--");
  const flags = dashes < 0 ? argv : argv.slice(0, dashes);
  const paths = dashes < 0 ? [] : argv.slice(dashes + 1);
  const value = (flag) => {
    const i = flags.indexOf(flag);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  try {
    const outcome = syncBranch({
      branch: value("--branch"),
      remote: value("--remote"),
      message: value("--message"),
      name: value("--name") ?? BOT_NAME,
      email: value("--email") ?? BOT_EMAIL,
      paths,
      token: process.env.GH_TOKEN ?? "",
    });
    const text = {
      pushed: `pushed ${value("--branch")} (${outcome.sha.slice(0, 9)})`,
      unchanged: `${value("--branch")} already holds this data (${outcome.remoteSha.slice(0, 9)}); not pushed`,
      foreign: `the newest commit on ${value("--branch")} is by ${outcome.author}, not the bot; leaving the branch alone`,
      none: "nothing to commit",
    }[outcome.result];
    console.log(`sync-branch: ${text}`);
    if (outcome.result === "foreign") {
      console.log(`::warning title=${value("--branch")} has commits by a person::${text}. Merge or close the pull request; the next run starts from a fresh branch.`);
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${outcome.result}\n`);
  } catch (e) {
    console.error(`sync-branch: ${String(e.stderr || e.message).trim()}`);
    process.exit(1);
  }
}
