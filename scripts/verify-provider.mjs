#!/usr/bin/env node
/**
 * Verifica un proveedor de storage REAL de punta a punta.
 *
 * Los tests unitarios cubren el protocolo (URLs, headers, XML) contra un fetch falso.
 * Esto cubre lo que ellos no pueden: que tus credenciales sirvan, que el bucket acepte
 * la escritura, que el objeto quede legible públicamente y que el borrado funcione.
 *
 * Uso:  node scripts/verify-provider.mjs [s3|r2|gcs|azure|modyo|blob]
 *       (sin argumento, prueba todos los que estén configurados por env)
 *
 * No borra nada que no haya creado: escribe bajo un prefijo único y lo limpia al final.
 */
import {
  availableProviders,
  s3Storage, s3ConfigFromEnv,
  r2Storage, r2ConfigFromEnv,
  gcsStorage, gcsConfigFromEnv,
  azureStorage, azureConfigFromEnv,
  modyoStorage, modyoConfigFromEnv,
} from "@dentvega/miniapp-storage";

const BUILDERS = {
  s3: [s3ConfigFromEnv, s3Storage],
  r2: [r2ConfigFromEnv, r2Storage],
  gcs: [gcsConfigFromEnv, gcsStorage],
  azure: [azureConfigFromEnv, azureStorage],
  modyo: [modyoConfigFromEnv, modyoStorage],
};

// Sin borrado: las versiones podadas se quedan publicadas (ver modyoStorage).
const SIN_BORRADO = new Set(["modyo"]);

const only = process.argv[2];
const configured = availableProviders(process.env).filter((p) => p in BUILDERS);
const targets = only ? [only] : configured;

if (targets.length === 0) {
  console.error("Ningún proveedor configurado. Seteá sus env vars primero (ver docs/SETUP.md).");
  process.exit(1);
}

// Prefijo único: si algo falla a mitad, no pisa nada real y se ve qué corrida lo dejó.
const stamp = `${process.pid}-${Math.floor(Number(process.hrtime.bigint() % 1000000n))}`;
const prefix = `__verify__/${stamp}`;
const body = new TextEncoder().encode(`verify ${stamp}\n`);
// Un .bundle con bytes no ASCII: el host compara el sha256 del chunk, así que el proveedor tiene
// que servirlo tal cual (sin recomprimir, minificar ni cambiar la codificación).
const bundle = new TextEncoder().encode(`// verify ${stamp} ñ ✓\nglobalThis.x = 1;\n`);
const sha256 = async (data) => Buffer.from(await crypto.subtle.digest("SHA-256", data)).toString("hex");

let failed = 0;

for (const name of targets) {
  const entry = BUILDERS[name];
  if (!entry) {
    console.error(`✗ ${name}: proveedor desconocido`);
    failed++;
    continue;
  }
  const [fromEnv, build] = entry;
  const cfg = fromEnv(process.env);
  if (cfg === null) {
    console.error(`✗ ${name}: faltan env vars`);
    failed++;
    continue;
  }

  console.log(`\n── ${name} ─────────────────────────────`);
  const storage = build(cfg);
  try {
    // 1. Escritura
    const { baseUrl } = await storage.putMany(prefix, [
      { path: "probe.json", data: body },
      { path: "probe.container.js.bundle", data: bundle },
    ]);
    console.log(`  ✓ escritura      → ${baseUrl}/probe.json`);

    // 2. Lectura pública — el host descarga los chunks por acá, así que tiene que ser legible
    //    SIN credenciales. Es el paso que más veces falla (bucket privado).
    const res = await fetch(`${baseUrl}/probe.json`);
    if (!res.ok) {
      console.error(`  ✗ lectura pública → HTTP ${res.status} — el bucket no es legible sin credenciales`);
      failed++;
    } else {
      const text = await res.text();
      if (text.trim() !== `verify ${stamp}`) {
        console.error(`  ✗ lectura pública → contenido inesperado: ${JSON.stringify(text.slice(0, 40))}`);
        failed++;
      } else {
        console.log(`  ✓ lectura pública → 200, contenido correcto`);
      }
    }

    // 3. El .bundle llega con los mismos bytes que se subieron.
    const chunk = await fetch(`${baseUrl}/probe.container.js.bundle`);
    const servido = chunk.ok ? new Uint8Array(await chunk.arrayBuffer()) : null;
    if (servido === null) {
      console.error(`  ✗ .bundle        → HTTP ${chunk.status}`);
      failed++;
    } else if ((await sha256(servido)) !== (await sha256(bundle))) {
      console.error(`  ✗ .bundle        → el sha256 no coincide: el proveedor modifica los bytes`);
      failed++;
    } else {
      console.log(`  ✓ .bundle        → mismo sha256 (${chunk.headers.get("content-type") ?? "sin content-type"})`);
    }

    // 4. Borrado (lo usa el prune de versiones viejas)
    if (SIN_BORRADO.has(name)) {
      console.log(`  - borrado        → no aplica: queda publicado en ${baseUrl}`);
      continue;
    }
    await storage.deletePrefix(prefix);
    const after = await fetch(`${baseUrl}/probe.json`);
    if (after.ok) {
      console.error(`  ✗ borrado        → el objeto sigue accesible (HTTP ${after.status})`);
      failed++;
    } else {
      console.log(`  ✓ borrado        → el objeto ya no responde (HTTP ${after.status})`);
    }
  } catch (err) {
    console.error(`  ✗ ${err instanceof Error ? err.message : err}`);
    failed++;
    // Intento de limpieza best-effort para no dejar basura si falló a mitad.
    try { await storage.deletePrefix(prefix); } catch {}
  }
}

console.log();
if (failed > 0) {
  console.error(`${failed} verificación(es) fallaron.`);
  process.exit(1);
}
console.log(`Todo OK (${targets.length} proveedor/es).`);
