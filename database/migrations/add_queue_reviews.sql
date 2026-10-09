-- Server-side queue + persistent reviews (the backend also applies this automatically on start).
ALTER TABLE payment_bookings
  ADD COLUMN queue_status VARCHAR(20) NULL,
  ADD COLUMN skipped_at DATETIME NULL,
  ADD COLUMN skip_count INT NOT NULL DEFAULT 0,
  ADD COLUMN completed_at DATETIME NULL;
UPDATE payment_bookings SET queue_status='Waiting' WHERE status='accepted' AND queue_status IS NULL;
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
