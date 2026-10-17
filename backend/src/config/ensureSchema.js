import { pool } from "./db.js";

// Idempotent schema checks. Existing data is preserved; this only adds the fields
// required by the current QR-payment flow and the persistent queue/review state.
async function ensureColumn(table, column, ddl) {
  const [r] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1",
    [table, column],
  );
  if (!r.length) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
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

  await pool.query(`CREATE TABLE IF NOT EXISTS schemes (
    id CHAR(36) PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT NULL,
    terms TEXT NULL,
    discount_type ENUM('percentage','fixed') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    starts_at DATETIME NULL,
    ends_at DATETIME NULL,
    all_services TINYINT(1) NOT NULL DEFAULT 1,
    service_ids_json JSON NOT NULL,
    all_barbers TINYINT(1) NOT NULL DEFAULT 1,
    barber_ids_json JSON NOT NULL,
    minimum_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    maximum_discount DECIMAL(10,2) NULL,
    usage_limit INT UNSIGNED NULL,
    per_customer_limit INT UNSIGNED NULL,
    promo_code VARCHAR(32) NULL,
    status ENUM('draft','active','paused') NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    UNIQUE KEY uq_scheme_shop_code (shop_id,promo_code),
    INDEX idx_scheme_shop_status (shop_id,status,starts_at,ends_at)
  ) ENGINE=InnoDB`);
  await ensureColumn("payment_bookings", "original_amount", "DECIMAL(10,2) NULL");
  await ensureColumn("payment_bookings", "discount_amount", "DECIMAL(10,2) NOT NULL DEFAULT 0");
  await ensureColumn("payment_bookings", "scheme_id", "CHAR(36) NULL");
  await pool.query("CREATE INDEX idx_booking_scheme_status ON payment_bookings (scheme_id,status)").catch((error) => {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  });

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
  await ensureColumn("payment_bookings", "scheduled_time", "TIME NULL");
  await ensureColumn("barbers", "queue_limit", "INT UNSIGNED NOT NULL DEFAULT 10");
  await pool.query(
    "CREATE INDEX idx_booking_scheduled_queue ON payment_bookings (booking_date,queue_status,barber_id)",
  ).catch((error) => {
    if (error.code !== "ER_DUP_KEYNAME") throw error;
  });
  await ensureColumn(
    "payment_bookings",
    "closure_choice",
    "VARCHAR(20) NULL",
  );
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

  await pool.query(`CREATE TABLE IF NOT EXISTS booking_service_edits (
    id CHAR(36) PRIMARY KEY,
    request_key CHAR(36) NOT NULL,
    booking_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NOT NULL,
    shop_id CHAR(36) NOT NULL,
    barber_id CHAR(36) NOT NULL,
    old_service_ids_json JSON NOT NULL,
    requested_service_ids_json JSON NOT NULL,
    amount_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
    proposed_total DECIMAL(10,2) NOT NULL,
    proposed_duration INT UNSIGNED NOT NULL,
    payment_reference VARCHAR(120) NULL,
    payer_name VARCHAR(120) NULL,
    status ENUM('payment_review','refund_review','applied','rejected') NOT NULL,
    payment_status ENUM('not_required','submitted','verified','declined') NOT NULL DEFAULT 'not_required',
    refund_status ENUM('not_required','requested','shop_confirmed') NOT NULL DEFAULT 'not_required',
    resolution_note VARCHAR(255) NULL,
    resolved_by CHAR(64) NULL,
    resolved_by_role ENUM('owner','shop','co_owner') NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    UNIQUE KEY uq_booking_service_edit_request (customer_id, request_key),
    UNIQUE KEY uq_booking_service_edit_payment_ref (payment_reference),
    INDEX idx_booking_service_edit_pending (shop_id, status, created_at),
    INDEX idx_booking_service_edit_booking (booking_id, created_at),
    FOREIGN KEY (booking_id) REFERENCES payment_bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  const [resolverConstraints] = await pool.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits'
       AND COLUMN_NAME='resolved_by' AND REFERENCED_TABLE_NAME IS NOT NULL`,
  );
  for (const constraint of resolverConstraints) {
    const name = String(constraint.CONSTRAINT_NAME).replaceAll("`", "``");
    await pool.query(`ALTER TABLE booking_service_edits DROP FOREIGN KEY \`${name}\``);
  }
  await ensureColumn("booking_service_edits", "resolved_by_role", "ENUM('owner','shop','co_owner') NULL");
  const [resolverColumn] = await pool.query(
    "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='resolved_by' LIMIT 1",
  );
  if (String(resolverColumn[0]?.COLUMN_TYPE || "").toLowerCase() !== "char(64)")
    await pool.query("ALTER TABLE booking_service_edits MODIFY COLUMN resolved_by CHAR(64) NULL");
  await ensureColumn("booking_service_edits", "proposed_total", "DECIMAL(10,2) NOT NULL DEFAULT 0");

  await pool.query(`CREATE TABLE IF NOT EXISTS emergency_closures (
    id CHAR(36) PRIMARY KEY,
    shop_id CHAR(36) NOT NULL,
    closure_type ENUM('hours','days') NOT NULL DEFAULT 'days',
    start_at DATETIME NOT NULL,
    end_at DATETIME NULL,
    reason VARCHAR(255) NULL,
    status ENUM('active','ended','expired') NOT NULL DEFAULT 'active',
    created_by CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX idx_emergency_closure_shop_period (shop_id, start_at, end_at, status)
  ) ENGINE=InnoDB`);

  await pool.query(`CREATE TABLE IF NOT EXISTS emergency_closure_notifications (
    closure_id CHAR(36) NOT NULL,
    booking_id CHAR(36) NOT NULL,
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (closure_id, booking_id),
    FOREIGN KEY (closure_id) REFERENCES emergency_closures(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES payment_bookings(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

}
