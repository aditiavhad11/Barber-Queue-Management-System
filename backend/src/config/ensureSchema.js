import { runMigrations } from "./migrate.js";

/**
 * @deprecated Use runMigrations() from ./migrate.js or `npm run migrate` instead.
 * Retained for backwards-compatibility with any legacy references.
 */
export async function ensureSchema() {
  return runMigrations();
}

export default ensureSchema;
