USE barber_queue;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL;
