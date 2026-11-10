-- Preserve payment and booking rows while allowing owner-only history hiding.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='deleted_at');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN deleted_at DATETIME NULL AFTER completed_at', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='deleted_by');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN deleted_by CHAR(64) NULL AFTER deleted_at', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='deleted_by_role');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN deleted_by_role VARCHAR(20) NULL AFTER deleted_by', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND INDEX_NAME='idx_booking_deleted_at');
SET @ddl := IF(@c=0, 'CREATE INDEX idx_booking_deleted_at ON payment_bookings (deleted_at)', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
