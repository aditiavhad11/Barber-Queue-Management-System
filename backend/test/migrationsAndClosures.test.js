import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../database/migrations");

test("migration files exist and follow sequential numbering pattern", () => {
  assert.equal(fs.existsSync(migrationsDir), true, "database/migrations must exist");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  assert.ok(files.length >= 2, "Expected at least 2 migration files");
  assert.equal(files[0], "001_initial_schema.sql");
  assert.equal(files[1], "002_schemes_and_features.sql");

  for (const file of files) {
    assert.match(file, /^\d{3}_[a-z0-9_]+\.sql$/, `Filename ${file} must match 000_name.sql format`);
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    assert.ok(content.length > 50, `${file} should contain valid migration statements`);
  }
});

test("001_initial_schema creates base tables and documents deprecated legacy tables", () => {
  const content = fs.readFileSync(path.join(migrationsDir, "001_initial_schema.sql"), "utf-8");
  assert.match(content, /CREATE TABLE IF NOT EXISTS users/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS shops/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS payment_bookings/i);
  assert.match(content, /DEPRECATED.*LEGACY TABLES/i);
  assert.match(content, /queue_entries/i);
  assert.match(content, /payments/i);
});

test("002_schemes_and_features includes schemes, reviews, co-owners, emergency closures, and audit tables", () => {
  const content = fs.readFileSync(path.join(migrationsDir, "002_schemes_and_features.sql"), "utf-8");
  assert.match(content, /CREATE TABLE IF NOT EXISTS schemes/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS booking_reviews/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS shop_co_owners/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS booking_service_edits/i);
  assert.match(content, /CREATE TABLE IF NOT EXISTS emergency_closures/i);
});

test("emergency closure derivation correctly identifies active vs ended/expired closures", () => {
  const now = new Date("2026-11-07T12:00:00Z");

  const activeClosure = {
    id: "closure-1",
    closure_type: "hours",
    start_at: new Date("2026-11-07T10:00:00Z").toISOString(),
    end_at: new Date("2026-11-07T14:00:00Z").toISOString(),
    reason: "Water pipeline repair",
  };

  const expiredClosure = {
    id: "closure-2",
    closure_type: "hours",
    start_at: new Date("2026-11-07T08:00:00Z").toISOString(),
    end_at: new Date("2026-11-07T11:00:00Z").toISOString(),
    reason: "Power outage",
  };

  function deriveAvailability(baseAvailability, closures, currentTime) {
    const activeClosures = closures || [];
    const currentClosure =
      activeClosures.find((c) => {
        const start = new Date(c.start_at);
        const end = c.end_at ? new Date(c.end_at) : null;
        return start <= currentTime && (!end || end > currentTime);
      }) || activeClosures[0];

    const availability = { ...baseAvailability };

    if (
      currentClosure &&
      new Date(currentClosure.start_at) <= currentTime &&
      (!currentClosure.end_at || new Date(currentClosure.end_at) > currentTime)
    ) {
      availability.emergencyClosed = true;
      availability.isOpen = false;
      availability.temporaryClosure = {
        id: currentClosure.id,
        active: true,
        type: currentClosure.closure_type,
        startAt: new Date(currentClosure.start_at).toISOString(),
        endAt: currentClosure.end_at
          ? new Date(currentClosure.end_at).toISOString()
          : null,
        reason: currentClosure.reason || "",
      };
    } else {
      availability.emergencyClosed = false;
      availability.temporaryClosure = currentClosure
        ? {
            id: currentClosure.id,
            active: true,
            type: currentClosure.closure_type,
            startAt: new Date(currentClosure.start_at).toISOString(),
            endAt: currentClosure.end_at
              ? new Date(currentClosure.end_at).toISOString()
              : null,
            reason: currentClosure.reason || "",
          }
        : null;
    }
    return availability;
  }

  // Active closure ongoing
  const resultActive = deriveAvailability({ isOpen: true }, [activeClosure], now);
  assert.equal(resultActive.emergencyClosed, true);
  assert.equal(resultActive.isOpen, false);
  assert.equal(resultActive.temporaryClosure?.id, "closure-1");

  // Closure expired
  const resultExpired = deriveAvailability({ isOpen: true }, [expiredClosure], now);
  assert.equal(resultExpired.emergencyClosed, false);
  assert.equal(resultExpired.isOpen, true);

  // No closures
  const resultNone = deriveAvailability({ isOpen: true }, [], now);
  assert.equal(resultNone.emergencyClosed, false);
  assert.equal(resultNone.isOpen, true);
  assert.equal(resultNone.temporaryClosure, null);
});
