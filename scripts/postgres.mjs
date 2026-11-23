#!/usr/bin/env node
/**
 * Tiny helper to run a local, self-contained PostgreSQL cluster for AgriSense.
 * Data lives in ./.pgdata (gitignored) and is reachable at 127.0.0.1:5433.
 *
 *   node scripts/postgres.mjs start | stop | status
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = join(root, ".pgdata");
const socketDir = process.env.PGSOCKETDIR || "/tmp/agrisense-pg";
const port = process.env.PGPORT || "5433";
const action = process.argv[2] || "start";

function findBin() {
  if (process.env.PGBIN) return process.env.PGBIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => existsSync(join(base, v, "bin", "initdb")))
      .sort()
      .reverse();
    if (versions.length) return join(base, versions[0], "bin");
  }
  throw new Error(
    "Could not find PostgreSQL binaries. Set PGBIN=/path/to/postgresql/bin.",
  );
}

const bin = findBin();
const run = (cmd, args, opts = {}) => {
  const result = spawnSync(join(bin, cmd), args, {
    stdio: "inherit",
    ...opts,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

mkdirSync(socketDir, { recursive: true });

if (action === "start") {
  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    mkdirSync(dataDir, { recursive: true });
    run("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-instructions"]);
  }
  run("pg_ctl", [
    "-D", dataDir,
    "-o", `-p ${port} -k ${socketDir} -h 127.0.0.1`,
    "-l", join(socketDir, "server.log"),
    "-w", "start",
  ]);
  console.log(`PostgreSQL ready on 127.0.0.1:${port} (database: app_db)`);
} else if (action === "stop") {
  run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
} else if (action === "status") {
  run("pg_ctl", ["-D", dataDir, "status"]);
} else {
  console.error("Usage: node scripts/postgres.mjs start | stop | status");
  process.exit(1);
}
