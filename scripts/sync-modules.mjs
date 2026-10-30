#!/usr/bin/env node
/**
 * Copia los paquetes de este repo a `modules/<paquete>` de un repo consumidor, que los usa con
 * `file:./modules/<paquete>` en vez de instalarlos de npm.
 *
 *   node scripts/sync-modules.mjs <repo> <paquete>... [--force] [--no-build]
 *   node scripts/sync-modules.mjs --check <repo>
 *
 * Cada módulo lleva package.json (sin lo de publicar ni desarrollar), src/ (sin tests), dist/ y
 * README.md. `modules/.source.json` guarda el commit y el sha256 de cada archivo: `--check` falla si
 * una copia se editó a mano, y una copia editada no se pisa salvo con --force. El script se copia
 * también a `modules/`, así el consumidor corre `node modules/sync-modules.mjs --check .`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECORD = ".source.json";
const DROP_KEYS = ["files", "scripts", "devDependencies", "publishConfig"];

/** package.json del módulo: sin lo de publicar ni desarrollar, y los paquetes hermanos por file:. */
export function adaptPackageJson(pkg, siblings) {
  const out = { ...pkg, private: true };
  for (const key of DROP_KEYS) delete out[key];
  if (pkg.dependencies) {
    out.dependencies = Object.fromEntries(
      Object.entries(pkg.dependencies).map(([name, range]) =>
        siblings[name] !== undefined && range.startsWith("workspace:")
          ? [name, `file:../${siblings[name]}`]
          : [name, range],
      ),
    );
  }
  return out;
}

const isTest = (rel) => rel.includes("__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(rel);

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Archivos del módulo (ruta relativa → contenido) a partir del paquete fuente. */
function moduleFiles(pkgDir, siblings) {
  const files = new Map();
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  files.set("package.json", `${JSON.stringify(adaptPackageJson(pkg, siblings), null, 2)}\n`);
  if (existsSync(join(pkgDir, "README.md"))) files.set("README.md", readFileSync(join(pkgDir, "README.md")));
  for (const dir of ["src", "dist"]) {
    for (const rel of walk(join(pkgDir, dir))) {
      const path = `${dir}/${rel}`;
      if (isTest(path) || path.endsWith(".tsbuildinfo")) continue;
      files.set(path, readFileSync(join(pkgDir, path)));
    }
  }
  return { pkg, files };
}

function readRecord(repo) {
  const file = join(repo, "modules", RECORD);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Diferencias entre una carpeta de módulo y lo registrado para ella. */
function diffModule(repo, dir, entry) {
  const base = join(repo, "modules", dir);
  const problems = [];
  const present = new Set(walk(base));
  for (const [rel, hash] of Object.entries(entry.files)) {
    if (!present.has(rel)) problems.push(`${dir}/${rel}: falta`);
    else if (sha256(readFileSync(join(base, rel))) !== hash) problems.push(`${dir}/${rel}: editado`);
    present.delete(rel);
  }
  for (const rel of present) problems.push(`${dir}/${rel}: no viene de la fuente`);
  return problems;
}

/** Problemas de los módulos de un repo respecto a `.source.json`; vacío si todo coincide. */
export function checkModules(repo) {
  const record = readRecord(repo);
  if (record === null) return [`modules/${RECORD}: falta`];
  return Object.entries(record.packages).flatMap(([dir, entry]) => diffModule(repo, dir, entry));
}

/**
 * Copia `dirs` (carpetas de packages/, p. ej. "miniapp-contract") a `<repo>/modules/`.
 * opts: { source: raíz de este repo, commit, build: compilar antes, force: pisar copias editadas }.
 */
export function syncModules(repo, dirs, { source, commit, build = true, force = false }) {
  const known = readdirSync(join(source, "packages")).filter((d) =>
    existsSync(join(source, "packages", d, "package.json")),
  );
  const siblings = Object.fromEntries(
    known.map((d) => [JSON.parse(readFileSync(join(source, "packages", d, "package.json"), "utf8")).name, d]),
  );
  for (const dir of dirs) {
    if (!known.includes(dir)) throw new Error(`paquete desconocido: ${dir} (hay: ${known.join(", ")})`);
  }

  const record = readRecord(repo) ?? { packages: {} };
  if (!force) {
    const edited = dirs.flatMap((dir) =>
      record.packages[dir] ? diffModule(repo, dir, record.packages[dir]) : [],
    );
    if (edited.length > 0) {
      throw new Error(`hay copias editadas a mano (usar --force para pisarlas):\n  ${edited.join("\n  ")}`);
    }
  }

  for (const dir of dirs) {
    const pkgDir = join(source, "packages", dir);
    if (build) execFileSync("pnpm", ["--filter", `./packages/${dir}`, "build"], { cwd: source, stdio: "inherit" });
    if (!existsSync(join(pkgDir, "dist"))) throw new Error(`${dir}: no hay dist/ (compilar el paquete antes)`);

    const { pkg, files } = moduleFiles(pkgDir, siblings);
    const target = join(repo, "modules", dir);
    rmSync(target, { recursive: true, force: true });
    const hashes = {};
    for (const [rel, data] of files) {
      mkdirSync(dirname(join(target, rel)), { recursive: true });
      writeFileSync(join(target, rel), data);
      hashes[rel] = sha256(data);
    }
    record.packages[dir] = { name: pkg.name, version: pkg.version, commit, files: hashes };
  }

  mkdirSync(join(repo, "modules"), { recursive: true });
  writeFileSync(join(repo, "modules", RECORD), `${JSON.stringify(record, null, 2)}\n`);
  // El mismo script, para que el consumidor compruebe sus copias con --check sin este repo.
  writeFileSync(join(repo, "modules", "sync-modules.mjs"), readFileSync(fileURLToPath(import.meta.url)));
}

// --- CLI ---
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [repo, ...dirs] = args.filter((a) => !a.startsWith("--"));
  const usage = "uso: sync-modules.mjs <repo> <paquete>... [--force] [--no-build] | --check <repo>";
  if (!repo) {
    console.error(usage);
    process.exit(2);
  }
  if (flags.has("--check")) {
    const problems = checkModules(resolve(repo));
    if (problems.length > 0) {
      console.error(`modules distintos de la fuente:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log("modules: OK");
    process.exit(0);
  }
  if (dirs.length === 0) {
    console.error(usage);
    process.exit(2);
  }
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "packages"], { cwd: source, encoding: "utf8" }).trim();
  try {
    syncModules(resolve(repo), dirs, {
      source,
      commit: dirty ? `${commit}+cambios` : commit,
      build: !flags.has("--no-build"),
      force: flags.has("--force"),
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`modules: ${dirs.join(", ")} → ${resolve(repo, "modules")} (${commit})`);
}
