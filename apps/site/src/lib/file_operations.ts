/**
 * Enhanced File Operation Handler
 * Detects file operations and routes them to the skills system
 */

import { initializeSkills } from '@brain/skills/index.js';
import { executeSkill, loadTrustLevel, getAvailableSkills } from '@metahuman/core/skills';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';
import fs from 'node:fs';

// Initialize skills when module loads
initializeSkills();

/**
 * Check if a message is requesting a file operation
 */
export function isFileOperation(message: string): boolean {
  const fileOps = [
    /\b(create|write|make|generate)\b.*\b(file|document|text)\b/i,
    /\b(save|store)\b.*\b(to|in)\b.*\b(file)\b/i,
    /\b(write|put)\b.*\b(to|in)\b.*\b(file)\b/i,
    /\b(create|make)\b.*\b(a|an)\b.*\b(file)\b/i,
    /\b(file.*create|create.*file)\b/i,
    /\b(make.*file|file.*make)\b/i,
    /\bsave.*to.*file\b/i,
    /\bwrite.*to.*file\b/i,
    /\b(output.*to.*file)\b/i,
    /\b(file.*output)\b/i
  ];
  
  return fileOps.some(regex => regex.test(message));
}

/**
 * Parse file operation request and extract parameters
 */
export function parseFileOperation(message: string): { 
  action: 'create' | 'write' | 'save'; 
  filename?: string; 
  content?: string;
  directory?: string;
} | null {
  // Simple parsing for now - could be enhanced with LLM
  const createPatterns = [
    /create (?:a )?file (?:named )?["']?([^"']+?)["']?(?: with (?:the )?content[s]? ?["']?(.+)["']?)?$/i,
    /write (?:the )?content[s]? ?["']?(.+)["']? to (?:a )?file (?:named )?["']?([^"']+?)["']?$/i,
    /save (?:the )?content[s]? ?["']?(.+)["']? to (?:a )?file (?:named )?["']?([^"']+?)["']?$/i,
    /make (?:a )?file (?:named )?["']?([^"']+?)["']?(?: with (?:the )?content[s]? ?["']?(.+)["']?)?$/i,
  ];
  
  for (const pattern of createPatterns) {
    const match = message.match(pattern);
    if (match) {
      if (pattern.toString().includes('write') || pattern.toString().includes('save')) {
        // Pattern: write content to file
        return {
          action: pattern.toString().includes('save') ? 'save' : 'write',
          filename: match[2]?.trim(),
          content: match[1]?.trim()
        };
      } else {
        // Pattern: create file with content
        return {
          action: 'create',
          filename: match[1]?.trim(),
          content: match[2]?.trim()
        };
      }
    }
  }
  
  // Fallback - just detect intent
  if (/\b(create|make)\b.*\bfile\b/i.test(message)) {
    const filenameMatch = message.match(/\b(?:named|called|titled)\s+["']?([^"'\s]+)["']?/i);
    return {
      action: 'create',
      filename: filenameMatch ? filenameMatch[1] : undefined
    };
  }
  
  return null;
}

/**
 * Execute a file operation using the skills system
 */
export async function executeFileOperation(operation: { 
  action: 'create' | 'write' | 'save'; 
  filename?: string; 
  content?: string;
  directory?: string;
}): Promise<{ success: boolean; message: string; path?: string }> {
  try {
    const trustLevel = loadTrustLevel();
    const availableSkills = getAvailableSkills(trustLevel);
    
    // Check if we have the required skills
    if (!availableSkills.some(s => s.id === 'fs_write')) {
      return {
        success: false,
        message: 'File writing skill not available at current trust level'
      };
    }
    
    // Generate filename if not provided
    let filename = operation.filename;
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `generated-${timestamp}.txt`;
    }
    
    // Ensure filename is safe and within allowed directories
    // For simplicity, we'll put all files in the out/ directory
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = path.join(paths.root, 'out', safeFilename);
    
    // Generate content if not provided
    let content = operation.content;
    if (!content) {
      content = `Generated file created on ${new Date().toISOString()}\n\nContent can be customized as needed.`;
    }
    
    // Execute the file write skill with auto-approval for chat-initiated operations
    const writeResult = await executeSkill('fs_write', {
      path: fullPath,
      content: content
    }, trustLevel, true); // Auto-approve for chat operations
    
    if (writeResult.success) {
      return {
        success: true,
        message: `Successfully created file "${safeFilename}" with ${content.length} characters.`,
        path: fullPath
      };
    } else {
      return {
        success: false,
        message: `Failed to create file: ${writeResult.error}`
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Error executing file operation: ${(error as Error).message}`
    };
  }
}

/**
 * Handle file operation request from chat
 */
export async function handleFileOperation(message: string): Promise<{ 
  success: boolean; 
  response: string; 
  path?: string 
}> {
  // Parse the operation
  const operation = parseFileOperation(message);
  
  if (!operation) {
    return {
      success: false,
      response: "I couldn't understand the file operation you requested. Please try rephrasing."
    };
  }
  
  // Execute the operation
  const result = await executeFileOperation(operation);
  
  return {
    success: result.success,
    response: result.message,
    path: result.path
  };
}