import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { adaptPackageJson, checkModules, syncModules } from "./sync-modules.mjs";

/** Un repo fuente falso con dos paquetes ya compilados: contract y runtime (que depende del primero). */
function fakeSource() {
  const root = mkdtempSync(join(tmpdir(), "sync-modules-src-"));
  const pkg = (dir, json, files) => {
    const base = join(root, "packages", dir);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(base, rel, ".."), { recursive: true });
      writeFileSync(join(base, rel), text);
    }
    writeFileSync(join(base, "package.json"), JSON.stringify(json, null, 2));
  };
  pkg(
    "miniapp-contract",
    {
      name: "@dentvega/miniapp-contract",
      version: "0.5.0",
      type: "module",
      main: "./dist/index.js",
      files: ["dist"],
      scripts: { build: "tsc", prepack: "pnpm build" },
      dependencies: { semver: "^7.6.0" },
      devDependencies: { typescript: "^5.6.3" },
      publishConfig: { access: "public" },
    },
    {
      "README.md": "# contract\n",
      "src/index.ts": "export const a = 1;\n",
      "src/__tests__/index.test.ts": "test\n",
      "src/other.test.ts": "test\n",
      "dist/index.js": "export const a = 1;\n",
      "dist/index.d.ts": "export declare const a = 1;\n",
      "jest.config.cjs": "module.exports = {};\n",
      "tsconfig.json": "{}\n",
    },
  );
  pkg(
    "miniapp-runtime",
    {
      name: "@dentvega/miniapp-runtime",
      version: "0.2.3",
      type: "module",
      main: "./dist/index.js",
      dependencies: { "@dentvega/miniapp-contract": "workspace:^", "@noble/curves": "^2.3.0" },
      peerDependencies: { react: ">=18" },
    },
    { "README.md": "# runtime\n", "src/index.ts": "export {};\n", "dist/index.js": "export {};\n" },
  );
  return root;
}

const fakeDest = () => mkdtempSync(join(tmpdir(), "sync-modules-dest-"));
const opts = (source) => ({ source, commit: "abc1234", build: false });

test("adaptPackageJson: deja lo que usa el consumidor y quita lo de publicar y desarrollar", () => {
  const out = adaptPackageJson(
    {
      name: "@dentvega/miniapp-runtime",
      version: "0.2.3",
      main: "./dist/index.js",
      files: ["dist"],
      scripts: { build: "tsc" },
      devDependencies: { jest: "^29" },
      publishConfig: { access: "public" },
      dependencies: { "@dentvega/miniapp-contract": "workspace:^", "@noble/curves": "^2.3.0" },
      peerDependencies: { react: ">=18" },
    },
    { "@dentvega/miniapp-contract": "miniapp-contract" },
  );
  assert.equal(out.main, "./dist/index.js");
  assert.equal(out.private, true);
  for (const key of ["files", "scripts", "devDependencies", "publishConfig"]) assert.equal(out[key], undefined);
  assert.deepEqual(out.dependencies, {
    "@dentvega/miniapp-contract": "file:../miniapp-contract",
    "@noble/curves": "^2.3.0",
  });
  assert.deepEqual(out.peerDependencies, { react: ">=18" });
});

test("syncModules copia src, dist, README y package.json, sin tests ni config", () => {
  const source = fakeSource();
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract"], opts(source));
  const mod = join(dest, "modules", "miniapp-contract");
  for (const rel of ["package.json", "README.md", "src/index.ts", "dist/index.js", "dist/index.d.ts"]) {
    assert.ok(existsSync(join(mod, rel)), rel);
  }
  for (const rel of ["src/__tests__/index.test.ts", "src/other.test.ts", "jest.config.cjs", "tsconfig.json"]) {
    assert.ok(!existsSync(join(mod, rel)), rel);
  }
  const record = JSON.parse(readFileSync(join(dest, "modules", ".source.json"), "utf8"));
  assert.equal(record.packages["miniapp-contract"].commit, "abc1234");
  assert.equal(record.packages["miniapp-contract"].version, "0.5.0");
  assert.ok(record.packages["miniapp-contract"].files["dist/index.js"].match(/^[0-9a-f]{64}$/));
});

test("syncModules falla si falta el dist (paquete sin compilar)", () => {
  const source = fakeSource();
  rmSync(join(source, "packages", "miniapp-contract", "dist"), { recursive: true });
  assert.throws(() => syncModules(fakeDest(), ["miniapp-contract"], opts(source)), /dist/);
});

test("checkModules: limpio tras sincronizar; detecta archivos editados, borrados y añadidos", () => {
  const source = fakeSource();
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract", "miniapp-runtime"], opts(source));
  assert.deepEqual(checkModules(dest), []);

  const mod = join(dest, "modules", "miniapp-contract");
  writeFileSync(join(mod, "dist", "index.js"), "export const a = 2;\n");
  rmSync(join(mod, "README.md"));
  writeFileSync(join(mod, "src", "extra.ts"), "x\n");
  assert.deepEqual(checkModules(dest).sort(), [
    "miniapp-contract/README.md: falta",
    "miniapp-contract/dist/index.js: editado",
    "miniapp-contract/src/extra.ts: no viene de la fuente",
  ]);
});

test("checkModules sin .source.json es un error", () => {
  assert.deepEqual(checkModules(fakeDest()), ["modules/.source.json: falta"]);
});

test("syncModules no pisa una copia editada a mano salvo con force", () => {
  const source = fakeSource();
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract"], opts(source));
  const file = join(dest, "modules", "miniapp-contract", "src", "index.ts");
  writeFileSync(file, "export const a = 99;\n");

  assert.throws(() => syncModules(dest, ["miniapp-contract"], opts(source)), /editado/);
  assert.equal(readFileSync(file, "utf8"), "export const a = 99;\n");

  syncModules(dest, ["miniapp-contract"], { ...opts(source), force: true });
  assert.equal(readFileSync(file, "utf8"), "export const a = 1;\n");
});

test("sincronizar un paquete conserva el registro de los demás y quita archivos que ya no existen", () => {
  const source = fakeSource();
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract", "miniapp-runtime"], opts(source));
  rmSync(join(source, "packages", "miniapp-contract", "dist", "index.d.ts"));
  syncModules(dest, ["miniapp-contract"], { ...opts(source), commit: "def5678" });

  const record = JSON.parse(readFileSync(join(dest, "modules", ".source.json"), "utf8"));
  assert.equal(record.packages["miniapp-contract"].commit, "def5678");
  assert.equal(record.packages["miniapp-runtime"].commit, "abc1234");
  assert.ok(!existsSync(join(dest, "modules", "miniapp-contract", "dist", "index.d.ts")));
  assert.deepEqual(checkModules(dest), []);
});

test("un paquete desconocido es un error", () => {
  assert.throws(() => syncModules(fakeDest(), ["miniapp-nada"], opts(fakeSource())), /miniapp-nada/);
});

test("deja el script en modules/ para que el consumidor pueda comprobar sus copias", () => {
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract"], opts(fakeSource()));
  const script = join(dest, "modules", "sync-modules.mjs");
  assert.ok(existsSync(script));
  assert.match(execFileSync("node", [script, "--check", dest], { encoding: "utf8" }), /OK/);
  writeFileSync(join(dest, "modules", "miniapp-contract", "README.md"), "otro\n");
  assert.throws(() => execFileSync("node", [script, "--check", dest], { stdio: "pipe" }));
});

test("checkModules avisa si git ignora archivos de un módulo (p. ej. dist/ en .gitignore)", () => {
  const dest = fakeDest();
  execFileSync("git", ["init", "-q"], { cwd: dest });
  writeFileSync(join(dest, ".gitignore"), "dist/\n");
  syncModules(dest, ["miniapp-contract"], opts(fakeSource()));
  assert.deepEqual(checkModules(dest).sort(), [
    "miniapp-contract/dist/index.d.ts: ignorado por git",
    "miniapp-contract/dist/index.js: ignorado por git",
  ]);
  writeFileSync(join(dest, ".gitignore"), "dist/\n!modules/*/dist/\n");
  assert.deepEqual(checkModules(dest), []);
});

test("checkModules ignora .DS_Store (Finder lo crea al abrir la carpeta)", () => {
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract"], opts(fakeSource()));
  writeFileSync(join(dest, "modules", "miniapp-contract", ".DS_Store"), "x");
  writeFileSync(join(dest, "modules", "miniapp-contract", "src", ".DS_Store"), "x");
  assert.deepEqual(checkModules(dest), []);
});

test("si un paquete falla, no se toca ningún módulo ni el registro", () => {
  const source = fakeSource();
  const dest = fakeDest();
  syncModules(dest, ["miniapp-contract", "miniapp-runtime"], opts(source));
  const before = readFileSync(join(dest, "modules", ".source.json"), "utf8");
  writeFileSync(join(source, "packages", "miniapp-contract", "src", "index.ts"), "export const a = 2;\n");
  rmSync(join(source, "packages", "miniapp-runtime", "dist"), { recursive: true });

  assert.throws(() => syncModules(dest, ["miniapp-contract", "miniapp-runtime"], { ...opts(source), commit: "zzz" }), /dist/);
  assert.equal(readFileSync(join(dest, "modules", ".source.json"), "utf8"), before);
  assert.equal(readFileSync(join(dest, "modules", "miniapp-contract", "src", "index.ts"), "utf8"), "export const a = 1;\n");
  assert.deepEqual(checkModules(dest), []);
});
