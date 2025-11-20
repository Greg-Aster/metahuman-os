#!/bin/bash
# Migration helper script for auth refactor
# Usage: ./scripts/migrate-auth-endpoint.sh apps/site/src/pages/api/example.ts

set -e

if [ $# -eq 0 ]; then
    echo "Usage: $0 <path-to-endpoint.ts>"
    echo "Example: $0 apps/site/src/pages/api/capture.ts"
    exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
    echo "Error: File not found: $FILE"
    exit 1
fi

echo "🔍 Analyzing $FILE..."

# Check if file uses old pattern
if grep -q "withUserContext" "$FILE"; then
    echo "✅ File uses old pattern (withUserContext found)"
else
    echo "⚠️  File doesn't use withUserContext - may already be migrated or use different pattern"
fi

if grep -q "getUserContext()" "$FILE"; then
    echo "✅ File uses getUserContext() - needs migration"
else
    echo "ℹ️  File doesn't use getUserContext() directly"
fi

# Check what's being imported
echo ""
echo "📦 Current imports:"
grep "^import.*from.*@metahuman/core" "$FILE" || echo "  (no core imports)"

echo ""
echo "🔧 Suggested changes:"
echo ""
echo "1. Change imports:"
echo "   - Remove: import { withUserContext } from '../../middleware/userContext';"
echo "   + Add: import { getAuthenticatedUser, getUserOrAnonymous, getProfilePaths } from '@metahuman/core';"
echo ""
echo "2. For GET handlers (read operations):"
echo "   const getHandler: APIRoute = async ({ cookies }) => {"
echo "     const user = getUserOrAnonymous(cookies);"
echo "     if (user.role === 'anonymous') { /* return defaults */ }"
echo "     const paths = getProfilePaths(user.username);"
echo "   };"
echo ""
echo "3. For POST/PUT/DELETE handlers (write operations):"
echo "   const postHandler: APIRoute = async ({ cookies, request }) => {"
echo "     const user = getAuthenticatedUser(cookies); // Throws 401 if not authed"
echo "     const paths = getProfilePaths(user.username);"
echo "   };"
echo ""
echo "4. Remove withUserContext wrapper from exports:"
echo "   - Before: export const GET = withUserContext(getHandler);"
echo "   + After:  export const GET = getHandler;"
echo "   - Before: export const POST = withUserContext(requireWriteMode(postHandler));"
echo "   + After:  export const POST = requireWriteMode(postHandler);"
echo ""
echo "5. Update audit calls to use username:"
echo "   audit({ actor: user.username, ... });"
echo ""
echo "📝 After migration, test:"
echo "   - Anonymous access (should work for GET, fail for writes)"
echo "   - Authenticated access (should work for everything)"
echo "   - Security guards still enforced (requireWriteMode, requireOwner, etc.)"
echo ""
echo "See docs/AUTH-MIGRATION-STATUS.md for full examples"
