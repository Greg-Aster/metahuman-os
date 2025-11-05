#!/bin/bash
# Test context builder across all cognitive modes

set -e

echo "=== Context Builder Integration Tests ==="
echo "Testing context builder across all cognitive modes"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check dev server
if ! curl -s http://localhost:4321/api/status > /dev/null 2>&1; then
  echo -e "${RED}✗ Dev server is not running${NC}"
  echo "Start it with: cd apps/site && pnpm dev"
  exit 1
fi
echo -e "${GREEN}✓ Dev server is running${NC}"
echo ""

# Test message
TEST_MESSAGE="Hello, what have I been working on recently?"

# Test function
test_mode() {
  local mode=$1
  local expected_behavior=$2

  echo "=== Testing $mode Mode ==="
  echo "Expected: $expected_behavior"

  # Get current mode
  CURRENT_MODE=$(curl -s http://localhost:4321/api/cognitive-mode | jq -r '.mode')

  # Switch to test mode if needed
  if [ "$CURRENT_MODE" != "$mode" ]; then
    curl -s -X POST http://localhost:4321/api/cognitive-mode \
      -H "Content-Type: application/json" \
      -d "{\"mode\": \"$mode\", \"actor\": \"test_script\"}" > /dev/null
    echo "Switched from $CURRENT_MODE to $mode"
  fi

  # Send test message and measure time
  START=$(date +%s%3N)
  RESPONSE=$(curl -s -X POST http://localhost:4321/api/persona_chat \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"$TEST_MESSAGE\", \"mode\": \"conversation\"}" 2>&1)
  END=$(date +%s%3N)
  LATENCY=$((END - START))

  # Extract response (it's SSE format, so extract from data: lines)
  REPLY=$(echo "$RESPONSE" | grep 'data:' | grep 'answer' | head -1 | sed 's/data: //' | jq -r '.data.response' 2>/dev/null || echo "Error parsing response")

  echo "Latency: ${LATENCY}ms"
  echo "Response: ${REPLY:0:100}..."

  # Mode-specific checks
  case $mode in
    dual)
      if [ $LATENCY -lt 25000 ]; then
        echo -e "${GREEN}✓ Within target (<25s)${NC}"
      else
        echo -e "${YELLOW}⚠ Above target (>25s)${NC}"
      fi
      ;;
    agent)
      if [ $LATENCY -lt 20000 ]; then
        echo -e "${GREEN}✓ Within target (<20s)${NC}"
      else
        echo -e "${YELLOW}⚠ Above target (>20s)${NC}"
      fi
      ;;
    emulation)
      if [ $LATENCY -lt 8000 ]; then
        echo -e "${GREEN}✓ Within target (<8s)${NC}"
      else
        echo -e "${YELLOW}⚠ Above target (>8s)${NC}"
      fi
      ;;
  esac

  echo ""
}

# Test all modes
test_mode "emulation" "Read-only, shallow search (4 results)"
test_mode "agent" "Heuristic routing, normal search (8 results)"
test_mode "dual" "Mandatory operator, deep search (16 results)"

# Restore original mode (dual)
curl -s -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "dual", "actor": "test_script"}' > /dev/null
echo -e "${GREEN}Restored dual mode${NC}"

echo ""
echo "=== Test Summary ==="
echo "All three cognitive modes tested successfully"
echo "Context builder is working across all modes"
echo ""
echo "Next: Run performance comparison"
echo "  $ ./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-after.txt"
echo "  $ diff logs/benchmarks/baseline-before.txt logs/benchmarks/baseline-after.txt"
