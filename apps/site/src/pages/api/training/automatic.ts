/**
 * Automatic Training API - GET/POST /api/training/automatic
 *
 * Policy and readiness live in core; the Sleep workflow trigger is intentionally
 * not installed by this route.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro'

export const GET = astroHandler
export const POST = astroHandler
