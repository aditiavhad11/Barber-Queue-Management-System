import { pool } from "./db.js";

// Idempotent schema checks. Existing data is preserved; this only adds the fields
// required by the current QR-payment flow and the persistent queue/review state.
async function ensureColumn(table, column, ddl) {
  const [r] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1",
    [table, column],
  );
  if (!r.length)
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

async function ensurePaymentStatusValue() {
  const [rows] = await pool.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='status' LIMIT 1",
  );
  if (
    !rows.length ||
    String(rows[0].COLUMN_TYPE).includes("'payment_submitted'")
  )
    return;
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
  await ensureColumn(
    "payment_bookings",
    "payment_method",
    "VARCHAR(30) NOT NULL DEFAULT 'upi_qr'",
  );
  await ensureColumn("payment_bookings", "payer_name", "VARCHAR(120) NULL");
  await ensureColumn(
    "payment_bookings",
    "payment_submitted_at",
    "DATETIME NULL",
  );
  await ensureColumn(
    "payment_bookings",
    "payment_reference",
    "VARCHAR(120) NULL",
  );
  await ensureColumn("payment_bookings", "declined_until", "DATETIME NULL");
  await ensureColumn("payment_bookings", "queue_status", "VARCHAR(20) NULL");
  await ensureColumn("payment_bookings", "skipped_at", "DATETIME NULL");
  await ensureColumn(
    "payment_bookings",
    "skip_count",
    "INT NOT NULL DEFAULT 0",
  );
  await ensureColumn("payment_bookings", "completed_at", "DATETIME NULL");
  await ensureColumn("payment_bookings", "booking_date", "DATE NULL");
  await ensureColumn(
    "complaints",
    "issue_type",
    "VARCHAR(80) NOT NULL DEFAULT 'Other'",
  );
  await ensureColumn(
    "complaints",
    "subject",
    "VARCHAR(190) NULL",
  );
  await ensureColumn("complaints", "description", "TEXT NULL");
  await ensureColumn("complaints", "resolved_at", "DATETIME NULL");
  await ensureColumn("complaints", "target_type", "ENUM('staff','owner') NOT NULL DEFAULT 'owner'");
  await ensureColumn("complaints", "target_barber_id", "CHAR(36) NULL");
  await pool.query("CREATE INDEX idx_complaint_routing ON complaints (target_type, shop_id, status)").catch((error) => {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  });

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

  await pool.query(`CREATE TABLE IF NOT EXISTS shop_co_owners (
    id CHAR(36) PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    title VARCHAR(60) NOT NULL DEFAULT 'Co-Owner',
    password_hash VARCHAR(255) NOT NULL,
    permissions_json JSON NOT NULL,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    INDEX idx_co_owner_shop (shop_id),
    INDEX idx_co_owner_email (email)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS service_unavailability (
    id CHAR(36) PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    service_id CHAR(36) NOT NULL,
    unavailable_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_service_unavailable_date (service_id, unavailable_date),
    INDEX idx_service_unavailability_shop_date (shop_id, unavailable_date),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}
