#!/bin/bash

# Test SEC API response for AAPL to see actual structure

echo "Fetching SEC submissions for AAPL (CIK 0000320193)..."
echo ""

curl -s "https://data.sec.gov/submissions/CIK0000320193.json" \
  -H "User-Agent: institutional-rotation-detector/1.0 (+https://github.com/institutional-rotation-detector)" \
  | jq '{
    name: .name,
    cik: .cik,
    tickers: .tickers,
    exchanges: .exchanges,
    securities: .securities | if . then length else "null" end,
    firstSecurities: .securities[0:3]
  }'

echo ""
echo "If securities is null or empty, that's why CUSIPs aren't being extracted!"
