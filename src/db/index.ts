import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Database = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & {
  __agriSensePool?: Pool;
  __agriSenseDb?: Database;
};

/**
 * The connection is created lazily on first use so that importing this module
 * (which Next.js does while collecting route metadata during `next build`)
 * does not require a DATABASE_URL or a live database.
 */
function getPool(): Pool {
  if (globalForDb.__agriSensePool) return globalForDb.__agriSensePool;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env and set your PostgreSQL connection string.",
    );
  }

  // Cache the pool on globalThis so hot reloads and requests do not create
  // fresh pools and exhaust PostgreSQL's connection limit.
  const pool = new Pool({ connectionString: databaseUrl, max: 20 });
  globalForDb.__agriSensePool = pool;
  return pool;
}

function getDb(): Database {
  if (globalForDb.__agriSenseDb) return globalForDb.__agriSenseDb;

  const instance = drizzle(getPool());
  globalForDb.__agriSenseDb = instance;
  return instance;
}

export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
