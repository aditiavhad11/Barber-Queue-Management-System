-- Persist per-booking delivery state so failed Redis jobs can be reconciled safely.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='emergency_closure_notifications' AND COLUMN_NAME='email_sent_at');
SET @ddl := IF(@c=0, 'ALTER TABLE emergency_closure_notifications ADD COLUMN email_sent_at DATETIME NULL AFTER sent_at', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
