-- Payments moved from Stripe to Dodo Payments.
--
--  * provider_session_id: the Dodo checkout session id for this payment.
--  * note: free-text operational note (e.g. a payment that was charged but
--    could not be applied and therefore needs a manual refund).
--  * bids.payment_id becomes UNIQUE: a payment can produce at most one bid
--    ledger row, so even a bug or a duplicated webhook cannot double-apply
--    money. This is the hard database-level idempotency guard.
--  * min_payment_cents: the smallest single charge we will create. Card
--    processors reject tiny charges, so an "outbid by 1 cent" top-up is
--    rounded up to this amount.

ALTER TABLE payments ADD COLUMN provider_session_id TEXT;
ALTER TABLE payments ADD COLUMN note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_payment_unique ON bids(payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(provider_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_ref);

INSERT OR IGNORE INTO settings (key, value) VALUES ('min_payment_cents', '100');
