-- Idempotent migration for the original-shop-QR payment flow.
-- Existing data is preserved. No existing columns are dropped.
USE barber_queue;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shops' AND COLUMN_NAME = 'upi_qr_url');
SET @ddl := IF(@c = 0, 'ALTER TABLE shops ADD COLUMN upi_qr_url TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'payment_method');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN payment_method VARCHAR(30) NOT NULL DEFAULT ''upi_qr''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'payer_name');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN payer_name VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'payment_submitted_at');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN payment_submitted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'payment_reference');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN payment_reference VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'declined_until');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN declined_until DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'queue_status');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN queue_status VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'skipped_at');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN skipped_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'skip_count');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN skip_count INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'completed_at');
SET @ddl := IF(@c = 0, 'ALTER TABLE payment_bookings ADD COLUMN completed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @type := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_bookings' AND COLUMN_NAME = 'status');
SET @ddl := IF(@type IS NOT NULL AND LOCATE("'payment_submitted'", @type) = 0,
  'ALTER TABLE payment_bookings MODIFY COLUMN status ENUM(\'payment_submitted\',\'accepted\',\'rejected\',\'created\',\'paid\',\'failed\',\'cancelled\') NOT NULL DEFAULT \'payment_submitted\'',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE payment_bookings
SET payment_submitted_at = COALESCE(payment_submitted_at, paid_at, created_at)
WHERE status = 'payment_submitted' AND payment_submitted_at IS NULL;
