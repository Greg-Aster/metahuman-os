#!/bin/bash
# Cognitive Architecture Baseline Metrics
# Run this before any architecture changes to establish performance baseline

set -e

echo "=== Cognitive Architecture Baseline Metrics ==="
echo "Date: $(date)"
echo "Host: $(hostname)"
echo ""

# Color output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if dev server is running
if ! curl -s http://localhost:4321/api/status > /dev/null 2>&1; then
    echo -e "${RED}Error: Dev server not running on port 4321${NC}"
    echo "Start it with: cd apps/site && pnpm dev"
    exit 1
fi

echo -e "${GREEN}✓ Dev server is running${NC}"
echo ""

# Test 1: Emulation mode (simplest - no operator)
echo "=== Test 1: Emulation Mode (Read-Only) ==="
echo "Expected: 5-8s (semantic search + base model)"
START=$(date +%s%N)
RESPONSE=$(curl -s "http://localhost:4321/api/persona_chat?message=Hello%2C%20how%20are%20you%3F&mode=conversation" 2>&1)
END=$(date +%s%N)
ELAPSED=$((($END - $START) / 1000000)) # Convert to milliseconds
ELAPSED_SEC=$(echo "scale=2; $ELAPSED / 1000" | bc)
echo "Latency: ${ELAPSED}ms (${ELAPSED_SEC}s)"
if [ $ELAPSED -lt 8000 ]; then
    echo -e "${GREEN}✓ Within target (<8s)${NC}"
else
    echo -e "${YELLOW}⚠ Above target (>8s)${NC}"
fi
echo ""

# Test 2: Agent mode (chat without operator)
echo "=== Test 2: Agent Mode (Chat) ==="
echo "Expected: 5-8s (heuristic routing skips operator for simple chat)"
START=$(date +%s%N)
RESPONSE=$(curl -s "http://localhost:4321/api/persona_chat?message=Tell%20me%20about%20your%20interests&mode=conversation" 2>&1)
END=$(date +%s%N)
ELAPSED=$((($END - $START) / 1000000))
ELAPSED_SEC=$(echo "scale=2; $ELAPSED / 1000" | bc)
echo "Latency: ${ELAPSED}ms (${ELAPSED_SEC}s)"
if [ $ELAPSED -lt 8000 ]; then
    echo -e "${GREEN}✓ Within target (<8s)${NC}"
else
    echo -e "${YELLOW}⚠ Above target (>8s)${NC}"
fi
echo ""

# Test 3: Agent mode (with operator - action-oriented message)
echo "=== Test 3: Agent Mode (Operator) ==="
echo "Expected: 15-20s (operator pipeline runs)"
START=$(date +%s%N)
RESPONSE=$(curl -s "http://localhost:4321/api/persona_chat?message=Create%20a%20task%20to%20review%20the%20code&mode=conversation" 2>&1)
END=$(date +%s%N)
ELAPSED=$((($END - $START) / 1000000))
ELAPSED_SEC=$(echo "scale=2; $ELAPSED / 1000" | bc)
echo "Latency: ${ELAPSED}ms (${ELAPSED_SEC}s)"
if [ $ELAPSED -lt 20000 ]; then
    echo -e "${GREEN}✓ Within target (<20s)${NC}"
else
    echo -e "${YELLOW}⚠ Above target (>20s)${NC}"
fi
echo ""

# Test 4: Dual mode (always uses operator)
echo "=== Test 4: Dual Consciousness Mode ==="
echo "Expected: 15-25s (mandatory operator pipeline)"
START=$(date +%s%N)
RESPONSE=$(curl -s "http://localhost:4321/api/persona_chat?message=What%20is%20the%20status%20of%20my%20tasks%3F&mode=conversation&forceOperator=true" 2>&1)
END=$(date +%s%N)
ELAPSED=$((($END - $START) / 1000000))
ELAPSED_SEC=$(echo "scale=2; $ELAPSED / 1000" | bc)
echo "Latency: ${ELAPSED}ms (${ELAPSED_SEC}s)"
if [ $ELAPSED -lt 25000 ]; then
    echo -e "${GREEN}✓ Within target (<25s)${NC}"
else
    echo -e "${YELLOW}⚠ Above target (>25s)${NC}"
fi
echo ""

# Test 5: Semantic search latency (if index exists)
echo "=== Test 5: Semantic Search Performance ==="
if [ -d "memory/index" ]; then
    echo "Index found, testing semantic search..."
    START=$(date +%s%N)
    ./bin/mh remember "coffee" > /dev/null 2>&1
    END=$(date +%s%N)
    ELAPSED=$((($END - $START) / 1000000))
    ELAPSED_SEC=$(echo "scale=2; $ELAPSED / 1000" | bc)
    echo "Latency: ${ELAPSED}ms (${ELAPSED_SEC}s)"
    if [ $ELAPSED -lt 2000 ]; then
        echo -e "${GREEN}✓ Within target (<2s)${NC}"
    else
        echo -e "${YELLOW}⚠ Above target (>2s)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ No semantic index found (memory/index/)${NC}"
    echo "Build index with: ./bin/mh index build"
fi
echo ""

# Test 6: Extract recent conversation timings from audit logs
echo "=== Test 6: Recent Conversation Audit Data ==="
TODAY=$(date +%Y-%m-%d)
AUDIT_FILE="logs/audit/${TODAY}.ndjson"

if [ -f "$AUDIT_FILE" ]; then
    echo "Analyzing audit logs from today..."

    # Count conversations by mode
    DUAL_COUNT=$(grep -c '"cognitiveMode":"dual"' "$AUDIT_FILE" 2>/dev/null || echo "0")
    AGENT_COUNT=$(grep -c '"cognitiveMode":"agent"' "$AUDIT_FILE" 2>/dev/null || echo "0")
    EMULATION_COUNT=$(grep -c '"cognitiveMode":"emulation"' "$AUDIT_FILE" 2>/dev/null || echo "0")

    echo "Conversation counts:"
    echo "  Dual: $DUAL_COUNT"
    echo "  Agent: $AGENT_COUNT"
    echo "  Emulation: $EMULATION_COUNT"
    echo ""

    # Extract timing data (requires jq)
    if command -v jq &> /dev/null; then
        echo "Timing analysis (last 10 conversations):"
        cat "$AUDIT_FILE" | \
            jq -r 'select(.event=="chat_assistant") |
                   "\(.details.cognitiveMode // "unknown")|\(.details.usedOperator // false)|\(.details.latencyMs // 0)"' | \
            tail -10 | \
            awk -F'|' '{
                mode=$1;
                operator=$2;
                latency=$3;
                printf "  %s (operator: %s): %dms\n", mode, operator, latency
            }'
    else
        echo -e "${YELLOW}⚠ jq not installed, skipping detailed timing analysis${NC}"
        echo "Install with: sudo apt-get install jq"
    fi
else
    echo -e "${YELLOW}⚠ No audit log for today${NC}"
fi
echo ""

# Test 7: Context retrieval breakdown (manual analysis)
echo "=== Test 7: Context Retrieval Breakdown ==="
echo "Manual test: Check persona_chat.ts logs for getRelevantContext() timing"
echo "Look for: [persona_chat] Context retrieval took XXXms"
echo ""

# Summary
echo "=== Summary ==="
echo "Baseline metrics captured. Save this output for comparison after changes:"
echo ""
echo "  \$ ./tests/benchmark-cognitive-baseline.sh > logs/benchmarks/baseline-$(date +%Y-%m-%d).txt"
echo ""
echo "Key metrics to track:"
echo "  • Emulation mode: < 8s target"
echo "  • Agent chat mode: < 8s target"
echo "  • Agent operator mode: < 20s target"
echo "  • Dual mode: < 25s target"
echo "  • Semantic search: < 2s target"
echo ""
echo "After implementing context builder:"
echo "  1. Run this script again"
echo "  2. Compare latencies (should be similar or better)"
echo "  3. Check audit logs for new 'context_package_built' events"
echo ""
