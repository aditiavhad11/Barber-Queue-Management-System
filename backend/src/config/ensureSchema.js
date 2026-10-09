import { pool } from "./db.js";

// Idempotent schema checks. Existing data is preserved; this only adds the fields
// required by the current QR-payment flow and the persistent queue/review state.
async function ensureColumn(table, column, ddl) {
  const [r] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1",
    [table, column],
  );
  if (!r.length) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

async function ensurePaymentStatusValue() {
  const [rows] = await pool.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='status' LIMIT 1",
  );
  if (!rows.length || String(rows[0].COLUMN_TYPE).includes("'payment_submitted'")) return;
  await pool.query(
    "ALTER TABLE payment_bookings MODIFY COLUMN status ENUM('created','paid','failed','cancelled','payment_submitted','accepted','rejected') NOT NULL DEFAULT 'payment_submitted'",
  );
}

export async function ensureSchema() {
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings'",
  );
  if (!cols.length) return;

  await ensureColumn("shops", "upi_qr_url", "TEXT NULL");
  await ensureColumn("payment_bookings", "payment_method", "VARCHAR(30) NOT NULL DEFAULT 'upi_qr'");
  await ensureColumn("payment_bookings", "payer_name", "VARCHAR(120) NULL");
  await ensureColumn("payment_bookings", "payment_submitted_at", "DATETIME NULL");
  await ensureColumn("payment_bookings", "payment_reference", "VARCHAR(120) NULL");
  await ensureColumn("payment_bookings", "declined_until", "DATETIME NULL");
  await ensureColumn("payment_bookings", "queue_status", "VARCHAR(20) NULL");
  await ensureColumn("payment_bookings", "skipped_at", "DATETIME NULL");
  await ensureColumn("payment_bookings", "skip_count", "INT NOT NULL DEFAULT 0");
  await ensureColumn("payment_bookings", "completed_at", "DATETIME NULL");

  await ensurePaymentStatusValue();

  await pool.query(
    "UPDATE payment_bookings SET payment_submitted_at=COALESCE(payment_submitted_at, paid_at, created_at) WHERE status='payment_submitted' AND payment_submitted_at IS NULL",
  );
  await pool.query(
    "UPDATE payment_bookings SET queue_status='Waiting' WHERE status='accepted' AND queue_status IS NULL",
  );

  await pool.query(`CREATE TABLE IF NOT EXISTS booking_reviews (
    id CHAR(36) PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NOT NULL,
    queue_id VARCHAR(60) NOT NULL UNIQUE,
    rating TINYINT UNSIGNED NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_booking_review_shop (shop_id)
  ) ENGINE=InnoDB`);
}
