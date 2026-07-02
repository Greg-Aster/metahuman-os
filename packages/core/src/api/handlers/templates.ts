import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

/**
 * GET /api/template/:name
 */
export async function handleGetTemplate(req: UnifiedRequest): Promise<UnifiedResponse> {
  const name = req.params?.id || req.params?.name;

  if (!name) {
    return {
      status: 400,
      data: { error: 'Template name required' },
    };
  }

  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return {
      status: 400,
      data: { error: 'Invalid template name' },
    };
  }

  try {
    const templatePath = path.join(systemPaths.root, 'etc', 'cognitive-graphs', `${name}.json`);

    if (!fs.existsSync(templatePath)) {
      return {
        status: 404,
        data: { error: `Template '${name}' not found` },
      };
    }

    return {
      status: 200,
      data: {
        success: true,
        template: JSON.parse(fs.readFileSync(templatePath, 'utf-8')),
        timestamp: Date.now(),
      },
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to load template',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
