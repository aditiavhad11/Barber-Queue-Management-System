-- =====================================================================
-- barber_queue : complete schema (merged)
-- Includes: schema.sql + add_password_auth + add_upi_qr_payment +
--           add_queue_reviews + add_service_unavailability +
--           add_complaint_details_and_resolution + add_complaint_target_routing +
--           add_schemes_offers + add_booking_service_edits
--
-- Safe to run on:
--   * a fresh server       -> Part 1 creates everything, Part 2 is a no-op
--   * an existing database -> Part 1 skips tables that exist, Part 2 adds
--                             any missing columns / indexes and backfills
-- Re-running is harmless (fully idempotent). Requires MySQL 8.0.16+.
-- =====================================================================

-- DANGER: uncomment ONLY for a throwaway dev reset. It wipes all data and
-- contradicts the "safe to re-run on an existing database" guarantee above.

DROP DATABASE IF EXISTS barber_queue;
CREATE DATABASE IF NOT EXISTS barber_queue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE barber_queue;

-- =====================================================================
-- PART 1 : TABLES (final shape, FK-safe creation order)
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  role ENUM('customer','owner','admin') NOT NULL,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS otp_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  role ENUM('customer','owner','admin') NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_email (email),
  INDEX idx_otp_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shops (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  contact VARCHAR(40) NOT NULL,
  address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  hours_open TIME NOT NULL,
  hours_close TIME NOT NULL,
  availability_json JSON NOT NULL,
  policies_json JSON NOT NULL,
  status ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  active TINYINT(1) NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  login_email VARCHAR(190) NOT NULL UNIQUE,
  login_password_hash VARCHAR(255) NOT NULL,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  review_count INT UNSIGNED NOT NULL DEFAULT 0,
  upi_qr_url TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shop_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_shop_owner (owner_id),
  INDEX idx_shop_status (status, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shop_photos (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  url TEXT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_photo_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS services (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_service_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS barbers (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  gender VARCHAR(40),
  age TINYINT UNSIGNED NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(190) NULL,
  experience_years INT UNSIGNED DEFAULT 0,
  specialization VARCHAR(180),
  working_days_json JSON NULL,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  status ENUM('Available','On Break','Unavailable') NOT NULL DEFAULT 'Available',
  photo_url TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_barber_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS barber_services (
  barber_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  PRIMARY KEY (barber_id, service_id),
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  shop_id CHAR(36) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_shop (customer_id, shop_id),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_entries (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  barber_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  token VARCHAR(20) NOT NULL,
  status ENUM('waiting','your_turn','in_service','completed','skipped','no_show','cancelled') NOT NULL DEFAULT 'waiting',
  payment_status ENUM('pending','successful','failed','refunded') NOT NULL DEFAULT 'pending',
  payment_amount DECIMAL(10,2) NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  INDEX idx_queue_shop_barber (shop_id, barber_id, status),
  INDEX idx_queue_customer (customer_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  queue_id CHAR(36),
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'mock',
  status ENUM('successful','failed','cancelled','refunded') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (queue_id) REFERENCES queue_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_payment_shop (shop_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schemes (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refunds (
  id CHAR(36) PRIMARY KEY,
  payment_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('requested','approved','processed','rejected') NOT NULL DEFAULT 'requested',
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  queue_id CHAR(36) NOT NULL UNIQUE,
  rating TINYINT UNSIGNED NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (rating BETWEEN 1 AND 5),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (queue_id) REFERENCES queue_entries(id) ON DELETE CASCADE,
  INDEX idx_review_shop (shop_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS complaints (
  id CHAR(36) PRIMARY KEY,
  customer_id CHAR(36) NOT NULL,
  shop_id CHAR(36) NOT NULL,
  issue TEXT NOT NULL,
  issue_type VARCHAR(80) NOT NULL DEFAULT 'Other',
  subject VARCHAR(190) NULL,
  description TEXT NULL,
  target_type ENUM('staff','owner') NOT NULL DEFAULT 'owner',
  target_barber_id CHAR(36) NULL,
  status ENUM('open','investigating','resolved','closed') NOT NULL DEFAULT 'open',
  resolved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_complaint_routing (target_type, shop_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36),
  shop_id CHAR(36),
  tone ENUM('info','ok','alert','warn') NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  read_at DATETIME NULL,
  ref_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  INDEX idx_notification_ref (ref_id),
  INDEX idx_notification_user (user_id, created_at),
  INDEX idx_notification_shop (shop_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_closures (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36),
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60),
  entity_id CHAR(36),
  metadata_json JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

-- Customer payment submissions. Only an owner ACCEPT moves a row into the queue.
CREATE TABLE IF NOT EXISTS payment_bookings (
  id CHAR(36) PRIMARY KEY,
  shop_id CHAR(36) NOT NULL,
  barber_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  booking_date DATE NULL,
  service_ids_json JSON NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  original_amount DECIMAL(10,2) NULL,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  scheme_id CHAR(36) NULL,
  duration_minutes INT UNSIGNED NOT NULL,
  beneficiary_json JSON NOT NULL,
  beneficiary_key VARCHAR(190) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'upi_qr',
  status ENUM('payment_submitted','accepted','rejected','created','paid','failed','cancelled') NOT NULL DEFAULT 'payment_submitted',
  failure_reason VARCHAR(255) NULL,
  payer_name VARCHAR(120) NULL,
  payment_submitted_at DATETIME NULL,
  payment_reference VARCHAR(120) NULL,
  token VARCHAR(20) NULL,
  queue_id VARCHAR(60) NULL,
  refund_id VARCHAR(64) NULL,
  refund_status VARCHAR(30) NULL,
  closure_choice VARCHAR(20) NULL,
  decline_reason VARCHAR(255) NULL,
  declined_until DATETIME NULL,
  paid_at DATETIME NULL,
  accepted_at DATETIME NULL,
  queue_status VARCHAR(20) NULL,
  skipped_at DATETIME NULL,
  skip_count INT NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_booking_shop_token (shop_id, token),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (scheme_id) REFERENCES schemes(id) ON DELETE SET NULL,
  INDEX idx_booking_shop_status (shop_id, status),
  INDEX idx_booking_customer (customer_id, status),
  INDEX idx_booking_request (customer_id, request_hash, status),
  INDEX idx_booking_scheme_status (scheme_id,status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emergency_closure_notifications (
  closure_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (closure_id, booking_id),
  FOREIGN KEY (closure_id) REFERENCES emergency_closures(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES payment_bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Service edit payments/refunds are kept separate from the original booking payment.
CREATE TABLE IF NOT EXISTS booking_service_edits (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS service_unavailability (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS booking_reviews (
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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shop_co_owners (
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
) ENGINE=InnoDB;


-- =====================================================================
-- PART 2 : UPGRADE OLDER DATABASES (no-op on a fresh install)
-- Each step checks information_schema first, so it is safe to re-run.
-- =====================================================================

-- ---- users (add_password_auth) --------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='password_hash');
SET @ddl := IF(@c=0, 'ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- shops (add_upi_qr_payment) -------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='upi_qr_url');
SET @ddl := IF(@c=0, 'ALTER TABLE shops ADD COLUMN upi_qr_url TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- payment_bookings (add_service_unavailability, add_upi_qr_payment, add_queue_reviews)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='booking_date');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN booking_date DATE NULL AFTER customer_id', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='payment_method');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN payment_method VARCHAR(30) NOT NULL DEFAULT ''upi_qr''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='payer_name');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN payer_name VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='payment_submitted_at');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN payment_submitted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='payment_reference');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN payment_reference VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='declined_until');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN declined_until DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='queue_status');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN queue_status VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='skipped_at');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN skipped_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='skip_count');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN skip_count INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='completed_at');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN completed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- status enum: add 'payment_submitted' etc. on databases created before the UPI flow
SET @type := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='status');
SET @ddl := IF(@type IS NOT NULL AND LOCATE('''payment_submitted''', @type)=0,
  'ALTER TABLE payment_bookings MODIFY COLUMN status ENUM(''payment_submitted'',''accepted'',''rejected'',''created'',''paid'',''failed'',''cancelled'') NOT NULL DEFAULT ''payment_submitted''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- schemes / offers (add_schemes_offers)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='original_amount');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN original_amount DECIMAL(10,2) NULL AFTER amount', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='discount_amount');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER original_amount', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='scheme_id');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN scheme_id CHAR(36) NULL AFTER discount_amount', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND INDEX_NAME='idx_booking_scheme_status');
SET @ddl := IF(@c=0, 'CREATE INDEX idx_booking_scheme_status ON payment_bookings (scheme_id,status)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- complaints (add_complaint_details_and_resolution, add_complaint_target_routing)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='issue_type');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN issue_type VARCHAR(80) NOT NULL DEFAULT ''Other''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='subject');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN subject VARCHAR(190) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='description');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN description TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='resolved_at');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN resolved_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing complaints default to owner review: their target cannot be safely
-- inferred from free-text issue descriptions.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='target_type');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN target_type ENUM(''staff'',''owner'') NOT NULL DEFAULT ''owner''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='target_barber_id');
SET @ddl := IF(@c=0, 'ALTER TABLE complaints ADD COLUMN target_barber_id CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND INDEX_NAME='idx_complaint_routing');
SET @ddl := IF(@c=0, 'CREATE INDEX idx_complaint_routing ON complaints (target_type, shop_id, status)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- data backfills (all guarded, safe to re-run) --------------------
UPDATE complaints SET description = issue WHERE description IS NULL;

UPDATE payment_bookings SET queue_status = 'Waiting'
WHERE status = 'accepted' AND queue_status IS NULL;

UPDATE payment_bookings
SET payment_submitted_at = COALESCE(payment_submitted_at, paid_at, created_at)
WHERE status = 'payment_submitted' AND payment_submitted_at IS NULL;

-- ---- barbers (new fields: age, phone, email, working_days_json) ------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='barbers' AND COLUMN_NAME='age');
SET @ddl := IF(@c=0, 'ALTER TABLE barbers ADD COLUMN age TINYINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='barbers' AND COLUMN_NAME='phone');
SET @ddl := IF(@c=0, 'ALTER TABLE barbers ADD COLUMN phone VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='barbers' AND COLUMN_NAME='email');
SET @ddl := IF(@c=0, 'ALTER TABLE barbers ADD COLUMN email VARCHAR(190) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='barbers' AND COLUMN_NAME='working_days_json');
SET @ddl := IF(@c=0, 'ALTER TABLE barbers ADD COLUMN working_days_json JSON NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- booking_service_edits (add_booking_service_edits) ---------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='proposed_total');
SET @ddl := IF(@c=0, 'ALTER TABLE booking_service_edits ADD COLUMN proposed_total DECIMAL(10,2) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='resolved_by_role');
SET @ddl := IF(@c=0, 'ALTER TABLE booking_service_edits ADD COLUMN resolved_by_role ENUM(''owner'',''shop'',''co_owner'') NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- resolved_by used to be a FK to users; it now holds owner / shop / co-owner ids
-- (CHAR(64)), so drop the old FK if present and widen the column.
SET @resolver_fk := NULL;
SELECT CONSTRAINT_NAME INTO @resolver_fk
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits'
  AND COLUMN_NAME='resolved_by' AND REFERENCED_TABLE_NAME IS NOT NULL
LIMIT 1;
SET @ddl := IF(@resolver_fk IS NULL, 'SELECT 1',
  CONCAT('ALTER TABLE booking_service_edits DROP FOREIGN KEY `', REPLACE(@resolver_fk, '`', '``'), '`'));
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @resolved_by_type := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='resolved_by');
SET @ddl := IF(LOWER(@resolved_by_type)='char(64)', 'SELECT 1',
  'ALTER TABLE booking_service_edits MODIFY COLUMN resolved_by CHAR(64) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;