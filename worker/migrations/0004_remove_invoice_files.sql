-- Cleanup for databases where the first invoice design was applied before it was changed to state-only storage.
DROP TABLE IF EXISTS invoices;
