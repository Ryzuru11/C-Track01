-- Migration: Add default timestamp to created_at column
-- Date: 2026-02-26

-- Step 1: Update existing NULL values to current timestamp
UPDATE reports 
SET created_at = CURRENT_TIMESTAMP 
WHERE created_at IS NULL;

-- Step 2: Modify column to have default value and be NOT NULL
ALTER TABLE reports 
MODIFY COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Verify the changes
SELECT COUNT(*) as total_reports, 
       COUNT(created_at) as reports_with_created_at,
       COUNT(*) - COUNT(created_at) as reports_with_null_created_at
FROM reports;
