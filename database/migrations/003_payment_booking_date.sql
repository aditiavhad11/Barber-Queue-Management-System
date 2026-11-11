-- Ensure older payment_bookings tables have the appointment date used by the queue worker.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_bookings' AND COLUMN_NAME='booking_date');
SET @ddl := IF(@c=0, 'ALTER TABLE payment_bookings ADD COLUMN booking_date DATE NULL AFTER customer_id', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;