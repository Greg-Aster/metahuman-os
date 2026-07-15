#!/usr/bin/env npx tsx

import { run } from './core.js';

run().catch((error) => {
  console.error('[environment-bridge] Fatal error:', error);
  process.exit(1);
});
