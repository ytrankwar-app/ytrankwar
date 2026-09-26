#!/bin/sh
# Empirically proves (doesn't just assert from documentation) that:
#   1. a naive read-await-write inside a Durable Object DOES lose updates
#      under real concurrency, when the await is for external I/O (a D1
#      query) — proving the concern behind BidCoordinator's design is real.
#   2. wrapping the identical logic in blockConcurrencyWhile() fixes it
#      completely.
#
# Run with: sh workers/verify-concurrency-proof.sh
# Requires nothing but this repo's own devDependencies (wrangler) — no
# Cloudflare account, no network access, no real deployment.

cd "$(dirname "$0")" || exit 1
rm -rf .wrangler
PORT=8799

npx wrangler d1 execute race-proof-db --local --config race-proof.wrangler.toml \
  --command "CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL); DELETE FROM counter; INSERT INTO counter (id, value) VALUES (1, 0);" \
  > /dev/null 2>&1

npx wrangler dev --config race-proof.wrangler.toml --local --port "$PORT" > /tmp/verify-concurrency.log 2>&1 &
SERVER_PID=$!

i=1
READY=0
while [ "$i" -le 30 ]; do
  sleep 1
  if curl -s -o /dev/null "http://localhost:$PORT/?kind=unsafe" 2>/dev/null; then
    READY=1
    break
  fi
  i=$((i + 1))
done

if [ "$READY" -ne 1 ]; then
  echo "FAILED: local wrangler dev never became ready. Log:"
  cat /tmp/verify-concurrency.log
  kill "$SERVER_PID" 2>/dev/null
  exit 1
fi

echo "=== 10 concurrent increments, WITHOUT blockConcurrencyWhile ==="
npx wrangler d1 execute race-proof-db --local --config race-proof.wrangler.toml \
  --command "UPDATE counter SET value = 0 WHERE id = 1;" > /dev/null 2>&1
PIDS=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o "/tmp/verify_unsafe_$i.txt" "http://localhost:$PORT/?kind=unsafe" &
  PIDS="$PIDS $!"
done
for pid in $PIDS; do wait "$pid" 2>/dev/null; done
cat /tmp/verify_unsafe_*.txt
echo ""
UNSAFE_RESULT=$(npx wrangler d1 execute race-proof-db --local --config race-proof.wrangler.toml --command "SELECT value FROM counter WHERE id = 1;" 2>&1 | grep -A1 '"value"' | grep -o '[0-9]*' | tail -1)
rm -f /tmp/verify_unsafe_*.txt
echo "Final counter value: $UNSAFE_RESULT (expected: NOT 10, proving the race is real)"

echo ""
echo "=== 10 concurrent increments, WITH blockConcurrencyWhile ==="
npx wrangler d1 execute race-proof-db --local --config race-proof.wrangler.toml \
  --command "UPDATE counter SET value = 0 WHERE id = 1;" > /dev/null 2>&1
PIDS=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o "/tmp/verify_safe_$i.txt" "http://localhost:$PORT/?kind=safe" &
  PIDS="$PIDS $!"
done
for pid in $PIDS; do wait "$pid" 2>/dev/null; done
cat /tmp/verify_safe_*.txt
echo ""
SAFE_RESULT=$(npx wrangler d1 execute race-proof-db --local --config race-proof.wrangler.toml --command "SELECT value FROM counter WHERE id = 1;" 2>&1 | grep -A1 '"value"' | grep -o '[0-9]*' | tail -1)
rm -f /tmp/verify_safe_*.txt
echo "Final counter value: $SAFE_RESULT (expected: exactly 10)"

kill "$SERVER_PID" 2>/dev/null

echo ""
if [ "$UNSAFE_RESULT" != "10" ] && [ "$SAFE_RESULT" = "10" ]; then
  echo "PROOF CONFIRMED: unsafe lost updates ($UNSAFE_RESULT/10), blockConcurrencyWhile did not (10/10)."
  exit 0
else
  echo "UNEXPECTED RESULT (unsafe=$UNSAFE_RESULT safe=$SAFE_RESULT) - investigate before trusting this."
  exit 1
fi
