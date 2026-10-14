import { test } from "node:test";
import assert from "node:assert/strict";
import { createPackageRegistry, parseGitHubRepository } from "../lib/packages.mjs";
import { DOCS_REPOSITORY, MANAGER_REPOSITORY, ROADMAP_PROJECT, repositoryForPage, repositoryOverview } from "../lib/repositories.mjs";
import { repoPackages } from "./helpers.mjs";

const PROFILE = "https://github.com/AstreoX";
const version = (v, extra = {}) => ({ version: v, ref: `v${v}`, requires: [], enginePlugins: [], provides: [], ...extra });
const entry = (name, versions, extra = {}) => ({
  name,
  friendlyName: name.replace(/^UBot/, "uBot "),
  description: { en: `${name} en`, "zh-CN": `${name} 中文` },
  repository: `https://github.com/AstreoX/${name.replace(/^UBot/, "uBot")}.git`,
  versions,
  ...extra,
});

/** Two released plugins (one with a ".git" repository URL), one planned plugin and one hosted elsewhere. */
function sampleRegistry() {
  return createPackageRegistry({
    formatVersion: 2,
    packages: [
      entry("UBotCore", [version("0.1.0")]),
      entry("UBotSensor", [version("0.1.0"), version("0.1.1")], { repository: "https://github.com/AstreoX/uBotSensor.git" }),
      entry("UBotVehicles", [{ version: "0.1.0", planned: true }]),
      entry("UBotElsewhere", [version("1.0.0")], { repository: "https://gitlab.example.invalid/team/elsewhere.git" }),
    ],
  });
}

const urlOf = (page, registry = sampleRegistry()) => repositoryForPage(page, registry).url;

test("a page of a released plugin's manual links to that plugin's repository, without the .git suffix", () => {
  const r = repositoryForPage("sensor/imu", sampleRegistry());
  assert.equal(r.url, "https://github.com/AstreoX/uBotSensor");
  assert.equal(r.name, "uBotSensor");
  assert.equal(r.kind, "plugin");
  assert.equal(r.label, "在 GitHub 上查看 uBotSensor 仓库");
  assert.equal(urlOf("core"), "https://github.com/AstreoX/uBotCore", "a plugin's overview page (its folder index)");
  assert.equal(urlOf("sensor/index"), "https://github.com/AstreoX/uBotSensor");
  assert.equal(urlOf("/sensor/imu/"), "https://github.com/AstreoX/uBotSensor", "a site path works as well as a content id");
  assert.equal(urlOf("sensor/imu.mdx"), "https://github.com/AstreoX/uBotSensor");
});

test("a page of the generated reference links to the repository of the package in its folder", () => {
  assert.equal(urlOf("reference/ubotsensor"), "https://github.com/AstreoX/uBotSensor");
  assert.equal(urlOf("reference/ubotsensor/uubotimusensorcomponent"), "https://github.com/AstreoX/uBotSensor");
  assert.equal(urlOf("/reference/ubotcore/fubotframeheader/"), "https://github.com/AstreoX/uBotCore");
  assert.equal(repositoryForPage("reference/ubotsensor/x", sampleRegistry()).kind, "plugin");
});

test("the reference pages that belong to no package link to this site's repository", () => {
  for (const page of ["reference", "reference/index", "reference/nodes", "reference/engine", "reference/ubotvehicles"]) {
    assert.equal(urlOf(page), DOCS_REPOSITORY.url, page);
  }
});

test("a page under /manager/ links to uBot Manager", () => {
  for (const page of ["manager", "manager/index", "manager/packages", "/manager/cli/"]) {
    const r = repositoryForPage(page, sampleRegistry());
    assert.equal(r.url, "https://github.com/AstreoX/uBotManager", page);
    assert.equal(r.kind, "manager");
    assert.equal(r.label, "在 GitHub 上查看 uBotManager 仓库");
  }
  assert.equal(MANAGER_REPOSITORY.url, "https://github.com/AstreoX/uBotManager");
});

test("the placeholder page of a planned plugin links to this site's repository", () => {
  const r = repositoryForPage("vehicles", sampleRegistry());
  assert.equal(r.url, DOCS_REPOSITORY.url);
  assert.equal(r.kind, "docs");
  assert.equal(urlOf("vehicles/index"), DOCS_REPOSITORY.url);
});

test("a plugin that is not hosted on GitHub has no repository to link: this site's repository is the fallback", () => {
  assert.equal(urlOf("elsewhere"), DOCS_REPOSITORY.url);
  assert.equal(urlOf("reference/ubotelsewhere"), DOCS_REPOSITORY.url);
});

test("the home page links to the roadmap Project, which is not a repository and not the profile page", () => {
  for (const page of ["index", "", "/", "index.mdx"]) {
    const r = repositoryForPage(page, sampleRegistry());
    assert.equal(r.url, "https://github.com/users/AstreoX/projects/2", `"${page}"`);
    assert.equal(r.url, ROADMAP_PROJECT.url);
    assert.equal(r.kind, "project");
    assert.equal(r.noun, "项目");
    assert.equal(r.label, "在 GitHub 上查看 uBot Roadmap 项目");
    assert.notEqual(r.url, PROFILE);
  }
  assert.equal(repositoryForPage("start/introduction", sampleRegistry()).noun, "仓库", "every other target is a repository");
});

test("cross-cutting pages link to this site's repository", () => {
  for (const page of ["start/introduction", "start/install", "concepts/frame-header", "develop/cpp", "appendix/glossary", "404", "mujoco"]) {
    const r = repositoryForPage(page, sampleRegistry());
    assert.equal(r.url, "https://github.com/AstreoX/uBotDocs", `"${page}"`);
    assert.equal(r.label, "在 GitHub 上查看 uBotDocs 仓库");
  }
  assert.equal(repositoryForPage(undefined, sampleRegistry()).url, DOCS_REPOSITORY.url);
});

test("a page whose folder name only looks like a plugin's folder is not matched by prefix or case", () => {
  assert.equal(urlOf("sensors/imu"), DOCS_REPOSITORY.url);
  assert.equal(urlOf("start/sensor"), DOCS_REPOSITORY.url, "only the first segment names the plugin");
  assert.equal(urlOf("Sensor/IMU"), "https://github.com/AstreoX/uBotSensor", "ids and paths are compared in lower case");
});

test("the link never points at the owner's profile page, for any page of the repository's own site", () => {
  const registry = repoPackages();
  const pages = [
    "index", "start/introduction", "manager", "reference", "reference/nodes",
    ...registry.list().flatMap((p) => [p.docsSlug, `${p.docsSlug}/index`, `${p.docsSlug}/anything`, `reference/${p.slug}`, `reference/${p.slug}/anything`]),
  ];
  for (const page of pages) {
    const r = repositoryForPage(page, registry);
    assert.notEqual(r.url, PROFILE, page);
    if (r.kind === "project") assert.equal(page, "index", "only the home page links to the Project");
    else assert.ok(parseGitHubRepository(r.url)?.repo, `${page}: ${r.url} is a repository`);
  }
});

test("every released plugin of the repository's data links to its own repository from its manual and its reference", () => {
  const registry = repoPackages();
  for (const p of registry.released()) {
    const expected = `https://github.com/${p.github.owner}/${p.github.repo}`;
    assert.ok(!expected.endsWith(".git"));
    assert.equal(repositoryForPage(`${p.docsSlug}/x`, registry).url, expected, p.name);
    assert.equal(repositoryForPage(`reference/${p.slug}`, registry).url, expected, p.name);
  }
  for (const p of registry.planned()) assert.equal(repositoryForPage(p.docsSlug, registry).url, DOCS_REPOSITORY.url, `${p.name} is planned: its placeholder links to this site`);
});

// ----------------------------------------------------------------------- the overview

test("the overview lists the released plugins in index order, then uBot Manager and this site; planned plugins are left out", () => {
  const rows = repositoryOverview(sampleRegistry());
  assert.deepEqual(rows.map((r) => r.name), ["uBotCore", "uBotSensor", "uBotManager", "uBotDocs"], "UBotVehicles is planned, UBotElsewhere is not on GitHub");
  assert.deepEqual(rows.map((r) => r.kind), ["plugin", "plugin", "manager", "docs"]);
  const sensor = rows[1];
  assert.equal(sensor.url, "https://github.com/AstreoX/uBotSensor");
  assert.equal(sensor.docsPath, "/sensor/");
  assert.equal(sensor.description, "UBotSensor 中文");
  assert.equal(sensor.version, "0.1.1");
  assert.equal(rows[2].url, MANAGER_REPOSITORY.url);
  assert.equal(rows[2].docsPath, "/manager/");
  assert.equal(rows[3].url, DOCS_REPOSITORY.url);
  assert.equal(rows[3].docsPath, "/", "this site links to its root");
});

test("every row has a name, a description, a GitHub repository and a link to the site; none is the profile page", () => {
  for (const r of repositoryOverview(repoPackages())) {
    assert.ok(r.name && r.description, r.name);
    assert.ok(parseGitHubRepository(r.url)?.repo === r.name, `${r.name}: ${r.url}`);
    assert.notEqual(r.url, PROFILE);
    assert.match(r.docsPath, /^\/(?:[a-z0-9-]+\/)?$/, `${r.name}: a root path of the site`);
    assert.ok(r.manualLabel);
  }
});

test("the overview follows the data: a plugin released later adds its row, a planned one adds none", () => {
  const index = {
    formatVersion: 2,
    packages: [entry("UBotCore", [version("0.1.0")]), entry("UBotNew", [{ version: "0.1.0", planned: true }])],
  };
  assert.deepEqual(repositoryOverview(createPackageRegistry(index)).map((r) => r.name), ["uBotCore", "uBotManager", "uBotDocs"]);
  index.packages[1].versions = [version("0.1.0")];
  const rows = repositoryOverview(createPackageRegistry(index));
  assert.deepEqual(rows.map((r) => r.name), ["uBotCore", "uBotNew", "uBotManager", "uBotDocs"]);
  assert.equal(rows[1].docsPath, "/new/");
  assert.equal(repositoryForPage("new/page", createPackageRegistry(index)).url, "https://github.com/AstreoX/uBotNew");
});
