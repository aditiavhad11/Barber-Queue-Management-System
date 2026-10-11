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

SET @has_booking_date = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payment_bookings'
    AND COLUMN_NAME = 'booking_date'
);
SET @booking_date_ddl = IF(
  @has_booking_date = 0,
  'ALTER TABLE payment_bookings ADD COLUMN booking_date DATE NULL AFTER customer_id',
  'SELECT 1'
);
PREPARE booking_date_stmt FROM @booking_date_ddl;
EXECUTE booking_date_stmt;
DEALLOCATE PREPARE booking_date_stmt;
