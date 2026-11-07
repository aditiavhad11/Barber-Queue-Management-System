import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, "../../../database/migrations");

/**
 * Splits SQL script into executable individual statements.
 * Strips comments and trims whitespace.
 */
function parseSqlStatements(sqlContent) {
  return sqlContent
    .split(/;\s*$/m)
    .map((stmt) => stmt.trim())
    .filter((stmt) => {
      // Filter out comments and empty statements
      const cleaned = stmt.replace(/^--.*$/gm, "").trim();
      return cleaned.length > 0;
    });
}

/**
 * Executes all pending numbered SQL migrations in database/migrations/.
 */
export async function runMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const connection = await pool.getConnection();

  try {
    // 1. Ensure migrations tracking table exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    // 2. Read all .sql files in migrations directory
    let files = [];
    try {
      files = await fs.readdir(migrationsDir);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.warn(`Migrations directory not found at: ${migrationsDir}`);
        return [];
      }
      throw err;
    }

    const migrationFiles = files
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!migrationFiles.length) {
      return [];
    }

    // 3. Fetch already applied migrations
    const [appliedRows] = await connection.query(
      "SELECT version FROM schema_migrations",
    );
    const appliedSet = new Set(appliedRows.map((row) => row.version));

    // 4. Run pending migrations in sorted order
    const appliedThisRun = [];

    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        continue;
      }

      console.log(`Running migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = await fs.readFile(filePath, "utf8");
      const statements = parseSqlStatements(sqlContent);

      for (const statement of statements) {
        if (!statement) continue;
        try {
          await connection.query(statement);
        } catch (stmtError) {
          throw new Error(
            `Migration failed in file "${file}": ${stmtError.message}\nStatement:\n${statement}`,
          );
        }
      }

      await connection.query(
        "INSERT INTO schema_migrations (version) VALUES (?)",
        [file],
      );

      console.log(`✓ Migration applied successfully: ${file}`);
      appliedThisRun.push(file);
    }

    return appliedThisRun;
  } finally {
    connection.release();
  }
}

// Allow direct execution: `node src/config/migrate.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log("Starting database migrations...");
  runMigrations()
    .then((applied) => {
      if (applied.length) {
        console.log(`Successfully applied ${applied.length} migration(s).`);
      } else {
        console.log("Database schema is already up to date.");
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration execution failed:", error);
      process.exit(1);
    });
}

export default runMigrations;

