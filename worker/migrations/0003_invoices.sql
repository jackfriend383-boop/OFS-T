-- Invoice state only. The uploaded file is sent directly to Resend and is not stored in D1.
ALTER TABLE orders ADD COLUMN invoice_sent_at TEXT;
