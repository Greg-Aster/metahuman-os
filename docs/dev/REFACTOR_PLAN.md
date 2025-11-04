### **Instructions for Refactoring Agent**

Here is a plan to refactor the MetaHuman OS codebase. The goal is to eliminate code duplication by centralizing all core logic in the `@metahuman/core` package and making the `metahuman-cli` package a consumer of that core logic.

**Step 1: Delete Redundant Files in `packages/cli`**

Remove the duplicated core logic from the `packages/cli` package. Delete the following files:
*   `packages/cli/src/lib/identity.ts`
*   `packages/cli/src/lib/memory.ts`
*   `packages/cli/src/lib/paths.ts`

**Step 2: Update CLI Imports**

Modify the main CLI source file (`packages/cli/src/mh-new.ts`) to import the necessary functions from the `@metahuman/core` package instead of its local `lib` directory.

You will need to read `packages/cli/src/mh-new.ts` and replace imports like:
`import { getIdentitySummary, setTrustLevel } from './lib/identity.js';`

with:
`import { getIdentitySummary, setTrustLevel } from '@metahuman/core/identity';`

And similarly for `memory` and `paths`.

**Step 3: Verify Functionality**

After refactoring, run the CLI commands to ensure that all functionality is working as expected. This will confirm that the `cli` is correctly using the `core` package. A good test would be to run:
*   `pnpm --filter metahuman-cli mh status`
*   `pnpm --filter metahuman-cli mh remember test`
*   `pnpm --filter metahuman-cli mh task list`

**Step 4: Audit Web UI (`apps/site`)**

Finally, check the API routes in the `apps/site` package to ensure they are also using `@metahuman/core` and not implementing their own logic. The files to inspect are:
*   `apps/site/src/pages/api/audit.ts`
*   `apps/site/src/pages/api/status.ts`
*   `apps/site/src/pages/api/tasks.ts`

If they contain duplicated logic, refactor them to import from `@metahuman/core` as well.

This refactoring will align the codebase with its documented architecture, making it more maintainable, streamlined, and robust.
