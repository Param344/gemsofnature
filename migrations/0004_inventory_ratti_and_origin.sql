-- Migration 0004: Add ratti_weight and origin to inventory_snapshots
-- Stage 4B: Physical inventory intake gemological attributes

ALTER TABLE inventory_snapshots ADD COLUMN ratti_weight REAL;
ALTER TABLE inventory_snapshots ADD COLUMN origin TEXT;
