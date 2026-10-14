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

SET @has_proposed_total := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='proposed_total'
);
SET @ddl := IF(@has_proposed_total=0,
  'ALTER TABLE booking_service_edits ADD COLUMN proposed_total DECIMAL(10,2) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_resolver_role := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='resolved_by_role'
);
SET @ddl := IF(@has_resolver_role=0,
  'ALTER TABLE booking_service_edits ADD COLUMN resolved_by_role ENUM(''owner'',''shop'',''co_owner'') NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT CONSTRAINT_NAME INTO @resolver_fk
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits'
  AND COLUMN_NAME='resolved_by' AND REFERENCED_TABLE_NAME IS NOT NULL
LIMIT 1;
SET @ddl := IF(@resolver_fk IS NULL, 'SELECT 1',
  CONCAT('ALTER TABLE booking_service_edits DROP FOREIGN KEY `', REPLACE(@resolver_fk, '`', '``'), '`'));
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @resolved_by_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='booking_service_edits' AND COLUMN_NAME='resolved_by'
);
SET @ddl := IF(LOWER(@resolved_by_type)='char(64)', 'SELECT 1',
  'ALTER TABLE booking_service_edits MODIFY COLUMN resolved_by CHAR(64) NULL');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
