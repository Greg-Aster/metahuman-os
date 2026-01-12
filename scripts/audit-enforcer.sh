#!/bin/bash
# Audit Enforcer - Checks that Claude agents are following the rules
# Run this periodically to verify audit quality

echo "🔍 AUDIT ENFORCER - Checking Compliance"
echo "========================================"
echo ""

# Check 1: Recent completed files have scratchpad entries
echo "📝 Checking: All completed files documented in scratchpad..."
completed_count=$(jq '[.files[] | select(.status == "completed")] | length' audit-state.json)
scratchpad_entries=$(grep -c "^## " audit-scratchpad.md || echo "0")

echo "   Completed files: $completed_count"
echo "   Scratchpad entries: $scratchpad_entries"

if [ "$scratchpad_entries" -lt "$completed_count" ]; then
    echo "   ⚠️  WARNING: Some completed files missing scratchpad entries!"
else
    echo "   ✅ PASS"
fi
echo ""

# Check 2: Recent commits
echo "📦 Checking: Files are being committed..."
recent_commits=$(git log --oneline --since="1 hour ago" | grep -c "audit(" || echo "0")
echo "   Audit commits in last hour: $recent_commits"
echo "   ✅ INFO"
echo ""

# Check 3: TypeScript compiles
echo "🔨 Checking: TypeScript compilation..."
if pnpm tsc --noEmit 2>&1 | grep -q "error TS"; then
    echo "   ❌ FAIL: TypeScript has errors!"
else
    echo "   ✅ PASS"
fi
echo ""

echo "========================================"
echo "Run 'pnpm tsx scripts/audit-status.ts' for full details"
