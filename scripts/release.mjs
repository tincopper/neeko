import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function run(cmd, ignoreError = false) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
  } catch (e) {
    if (!ignoreError) throw e;
  }
}

function exit(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

const raw = process.argv[2];
if (!raw) {
  exit("Usage: pnpm release <version>\n  e.g. pnpm release 1.0.4");
}

const version = raw.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+/.test(version)) {
  exit(`Invalid version: ${version}`);
}

const tag = `v${version}`;
console.log(`\nReleasing ${tag}\n`);

try {
  // Update tauri.conf.json
  const tauriConfPath = resolve(ROOT, "src-tauri/tauri.conf.json");
  const tauriConf = readFileSync(tauriConfPath, "utf-8");
  writeFileSync(
    tauriConfPath,
    tauriConf.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  );
  console.log(`✓ Updated src-tauri/tauri.conf.json → ${version}`);

  // Update Cargo.toml (first `version = "..."` line only)
  const cargoPath = resolve(ROOT, "src-tauri/Cargo.toml");
  const cargo = readFileSync(cargoPath, "utf-8");
  let replaced = false;
  const cargoUpdated = cargo.replace(/^version\s*=\s*"[^"]*"/m, (match) => {
    if (!replaced) {
      replaced = true;
      return `version = "${version}"`;
    }
    return match;
  });
  writeFileSync(cargoPath, cargoUpdated);
  console.log(`✓ Updated src-tauri/Cargo.toml → ${version}`);

  // Update package.json
  const pkgPath = resolve(ROOT, "package.json");
  const pkg = readFileSync(pkgPath, "utf-8");
  writeFileSync(
    pkgPath,
    pkg.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  );
  console.log(`✓ Updated package.json → ${version}`);

  // Generate CHANGELOG.md via git-cliff
  try {
    execSync("git-cliff --version", { cwd: ROOT, stdio: "ignore" });
  } catch {
    console.log("⚠ git-cliff not found, installing...");
    run("cargo install git-cliff");
  }
  run(`git-cliff --output CHANGELOG.md --tag ${tag}`);
  console.log("✓ Generated CHANGELOG.md");

  // Git commit + tag
  run("git add .");
  run(`git commit -m "release: ${tag}"`);
  run(`git tag ${tag}`);

  console.log(`\n✅ Released ${tag}`);
  console.log(`\nNext steps:`);
  console.log(`  git push && git push --tags`);
} catch (e) {
  console.error(`\n❌ Release failed: ${e.message || e}`);
  console.error(`\nNo changes were committed.`);
  process.exit(1);
}
