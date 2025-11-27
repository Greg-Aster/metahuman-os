/**
 * Enhanced File Operation Handler for Web UI
 * Detects file operations and routes them to the skills system
 */

import { initializeSkills } from '@brain/skills/index.js';
import { executeSkill, loadTrustLevel, getAvailableSkills, listSkills } from '@metahuman/core/skills';
import { paths } from '@metahuman/core/paths';
import path from 'node:path';

// Initialize skills when module loads
initializeSkills();

/**
 * Check if a message is requesting a file operation
 */
export function isFileOperation(message: string): boolean {
  const fileOperationPatterns = [
    /\bcreate\s+(?:a\s+)?file\b/i,
    /\bmake\s+(?:a\s+)?file\b/i,
    /\bwrite\s+(?:to\s+)?file\b/i,
    /\bsave\s+(?:to\s+)?file\b/i,
    /\bgenerate\s+(?:a\s+)?file\b/i,
    /\bcreate\s+(?:a\s+)?document\b/i,
    /\bmake\s+(?:a\s+)?document\b/i,
    /\bwrite\s+(?:to\s+)?document\b/i,
    /\bsave\s+(?:to\s+)?document\b/i,
    /\bfile\s+creation\b/i,
    /\bfile\s+writing\b/i,
    /\bfile\s+generation\b/i
  ];
  
  return fileOperationPatterns.some(pattern => pattern.test(message));
}

/**
 * Extract file operation details from message
 */
export function extractFileOperationDetails(message: string): { 
  filename: string; 
  content: string;
  action: 'create' | 'write' | 'save'
} | null {
  // Patterns for extracting file operations
  const patterns = [
    // Pattern: "Create a file named X with content Y"
    {
      regex: /create\s+(?:a\s+)?file\s+(?:named\s+)?["']?([^"'\n]+?)["']?(?:\s+with\s+(?:the\s+)?content[s]?\s+["']?(.+)["']?)?$/i,
      action: 'create'
    },
    // Pattern: "Write content Y to file X"
    {
      regex: /write\s+(?:the\s+)?content[s]?\s+["']?(.+)["']?\s+to\s+(?:a\s+)?file\s+(?:named\s+)?["']?([^"'\n]+?)["']?$/i,
      action: 'write'
    },
    // Pattern: "Save content Y to file X"
    {
      regex: /save\s+(?:the\s+)?content[s]?\s+["']?(.+)["']?\s+to\s+(?:a\s+)?file\s+(?:named\s+)?["']?([^"'\n]+?)["']?$/i,
      action: 'save'
    },
    // Pattern: "Make a file named X with content Y"
    {
      regex: /make\s+(?:a\s+)?file\s+(?:named\s+)?["']?([^"'\n]+?)["']?(?:\s+with\s+(?:the\s+)?content[s]?\s+["']?(.+)["']?)?$/i,
      action: 'create'
    },
    // Pattern: "Create file X with content Y"
    {
      regex: /create\s+file\s+["']?([^"'\n]+?)["']?(?:\s+with\s+(?:the\s+)?content[s]?\s+["']?(.+)["']?)?$/i,
      action: 'create'
    }
  ];
  
  for (const { regex, action } of patterns) {
    const match = message.match(regex);
    if (match) {
      if (action === 'write' || action === 'save') {
        // Pattern: write/save content to file
        return {
          action: action,
          filename: match[2]?.trim() || 'untitled.txt',
          content: match[1]?.trim() || 'Generated content'
        };
      } else {
        // Pattern: create/make file with content
        return {
          action: 'create',
          filename: match[1]?.trim() || 'untitled.txt',
          content: match[2]?.trim() || 'Generated content'
        };
      }
    }
  }
  
  return null;
}

/**
 * Handle file operation using skills system
 */
export async function handleFileOperation(message: string): Promise<{ 
  success: boolean; 
  response: string; 
  path?: string 
} | null> {
  // Check if this is a file operation request
  if (!isFileOperation(message)) {
    return null;
  }
  
  // Extract operation details
  const details = extractFileOperationDetails(message);
  if (!details) {
    return {
      success: false,
      response: "I couldn't understand the file operation you requested. Please try rephrasing."
    };
  }
  
  try {
    const trustLevel = loadTrustLevel();
    
    // Validate that we have the required skill
    const availableSkills = getAvailableSkills(trustLevel);
    if (!availableSkills.some(s => s.id === 'fs_write')) {
      return {
        success: false,
        response: '❌ File writing skill not available at current trust level'
      };
    }
    
    // Sanitize filename and create safe path
    const safeFilename = path.basename(details.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = path.join(paths.root, 'out', safeFilename);
    
    // Execute the file write skill with auto-approval
    const writeResult = await executeSkill('fs_write', {
      path: fullPath,
      content: details.content
    }, trustLevel, true); // Auto-approve for chat operations
    
    if (writeResult.success) {
      return {
        success: true,
        response: `✅ Successfully created file "${safeFilename}" with ${details.content.length} characters.`,
        path: fullPath
      };
    } else {
      return {
        success: false,
        response: `❌ Failed to create file: ${writeResult.error}`
      };
    }
  } catch (error) {
    return {
      success: false,
      response: `❌ Error executing file operation: ${(error as Error).message}`
    };
  }
}