-- Existing complaints default to owner review because their intended target
-- cannot be safely inferred from free-text issue descriptions.
SET @has_target_type := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='target_type'
);
SET @ddl := IF(@has_target_type=0,
  'ALTER TABLE complaints ADD COLUMN target_type ENUM(''staff'',''owner'') NOT NULL DEFAULT ''owner''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_target_barber := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND COLUMN_NAME='target_barber_id'
);
SET @ddl := IF(@has_target_barber=0,
  'ALTER TABLE complaints ADD COLUMN target_barber_id CHAR(36) NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_routing_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='complaints' AND INDEX_NAME='idx_complaint_routing'
);
SET @ddl := IF(@has_routing_index=0,
  'CREATE INDEX idx_complaint_routing ON complaints (target_type, shop_id, status)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
