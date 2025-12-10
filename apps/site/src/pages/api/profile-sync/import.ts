/**
 * POST /api/profile-sync/import
 *
 * ONE LINE - calls unified handler via astroHandler.
 * SAME business logic as mobile.
 */
import { astroHandler } from "@metahuman/core/api/adapters/astro";

export const POST = astroHandler;

