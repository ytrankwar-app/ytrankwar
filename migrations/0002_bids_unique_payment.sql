-- Hard guarantee behind confirmPayment()'s idempotency (lib/bidding-service.ts):
-- a payment can produce at most one ledger row, no matter how many times, or
-- how concurrently, its webhook is delivered.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bids_payment ON bids(payment_id);
