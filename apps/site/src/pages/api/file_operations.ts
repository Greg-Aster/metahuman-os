/**
 * File Operations API
 * Dedicated endpoint for file operations using the skills system
 */

import type { APIRoute } from 'astro';
// DISABLED: Skills system not in use
// import { initializeSkills } from '@brain/skills/index.js';
import { executeSkill, loadTrustLevel, getAvailableSkills } from '@metahuman/core/skills';
import { paths } from '@metahuman/core/paths';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import path from 'node:path';

// DISABLED: Skills system not in use
// Initialize skills when module loads
// initializeSkills();

interface FileOperationRequest {
  action: 'create' | 'read' | 'write' | 'delete';
  filename: string;
  content?: string;
  overwrite?: boolean;
}

interface FileOperationResponse {
  success: boolean;
  message: string;
  path?: string;
  content?: string;
  error?: string;
}

export const POST: APIRoute = async (context) => {
  try {
    const body: Partial<FileOperationRequest> = await context.request.json();
    const { action, filename, content, overwrite } = body;

    if (!action || !filename) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Action and filename are required'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate filename
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = path.join(paths.root, 'out', safeFilename);

    // Check file access permissions
    const policy = getSecurityPolicy(context);
    try {
      policy.requireFileAccess(fullPath);
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: (error as Error).message,
          details: (error as any).details
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trustLevel = loadTrustLevel();
    const availableSkills = getAvailableSkills(trustLevel);

    switch (action) {
      case 'create':
      case 'write':
        // Check if fs_write skill is available
        if (!availableSkills.some(s => s.id === 'fs_write')) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'File writing skill not available at current trust level' 
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (!content) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Content is required for create/write operations' 
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Execute the file write skill
        const writeInputs: Record<string, any> = {
          path: fullPath,
          content: content
        };
        
        // Only add overwrite if it's explicitly provided
        if (typeof overwrite === 'boolean') {
          writeInputs.overwrite = overwrite;
        }
        
        const writeResult = await executeSkill('fs_write', writeInputs, trustLevel, true); // Auto-approve for API calls
        
        if (writeResult.success) {
          return new Response(
            JSON.stringify({
              success: true,
              message: `Successfully created file "${safeFilename}"`,
              path: fullPath
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              error: writeResult.error || 'Failed to create file'
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

      case 'read':
        // Check if fs_read skill is available
        if (!availableSkills.some(s => s.id === 'fs_read')) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'File reading skill not available at current trust level' 
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Execute the file read skill
        const readResult = await executeSkill('fs_read', {
          path: fullPath
        }, trustLevel);
        
        if (readResult.success) {
          return new Response(
            JSON.stringify({
              success: true,
              message: `Successfully read file "${safeFilename}"`,
              path: fullPath,
              content: readResult.outputs?.content
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } else {
          return new Response(
            JSON.stringify({
              success: false,
              error: readResult.error || 'Failed to read file'
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

      default:
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Unsupported action: ${action}` 
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[file_operations_api] Unexpected error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `File operations API error: ${(error as Error).message}` 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'status';
    
    switch (action) {
      case 'status':
        const trustLevel = loadTrustLevel();
        const availableSkills = getAvailableSkills(trustLevel);
        
        return new Response(
          JSON.stringify({
            status: 'online',
            trustLevel,
            canWrite: availableSkills.some(s => s.id === 'fs_write'),
            canRead: availableSkills.some(s => s.id === 'fs_read'),
            basePath: path.join(paths.root, 'out')
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('[file_operations_api] Status check error:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: `Status check error: ${(error as Error).message}` 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};