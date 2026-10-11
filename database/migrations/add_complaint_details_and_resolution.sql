SET @has_issue_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='issue_type'
);
SET @ddl = IF(@has_issue_type=0,
  'ALTER TABLE complaints ADD COLUMN issue_type VARCHAR(80) NOT NULL DEFAULT ''Other''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_subject = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='subject'
);
SET @ddl = IF(@has_subject=0,
  'ALTER TABLE complaints ADD COLUMN subject VARCHAR(190) NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_description = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='description'
);
SET @ddl = IF(@has_description=0,
  'ALTER TABLE complaints ADD COLUMN description TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_resolved_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='resolved_at'
);
SET @ddl = IF(@has_resolved_at=0,
  'ALTER TABLE complaints ADD COLUMN resolved_at DATETIME NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE complaints SET description=issue WHERE description IS NULL;
