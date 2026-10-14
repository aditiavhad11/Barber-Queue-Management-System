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
