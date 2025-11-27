import type { APIRoute } from 'astro';
import { loadPersonaCore, ollama, captureEvent, ROOT, listActiveTasks, audit, getIndexStatus, queryIndex, buildRagContext, searchMemory, loadTrustLevel } from '@metahuman/core';
import { readFileSync, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { initializeSkills } from '@brain/skills/index.js';
import { getAvailableSkills, executeSkill, type SkillManifest } from '@metahuman/core/skills';

// Initialize skills
initializeSkills();

// ====================================================================================================
// Enhanced File Operation Detection and Handling
// ====================================================================================================

/**
 * Check if a message is requesting a file operation
 */
function isFileOperationRequest(message: string): boolean {
  const fileOperationKeywords = [
    'create file', 'make file', 'write file', 'save file', 'generate file',
    'create a file', 'make a file', 'write a file', 'save a file', 'generate a file',
    'write to file', 'save to file', 'output to file',
    'create document', 'make document', 'write document', 'save document',
    'file creation', 'file writing', 'file generation'
  ];
  
  const lowerMessage = message.toLowerCase();
  return fileOperationKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Extract file operation details from message
 */
function extractFileOperationDetails(message: string): { 
  filename: string; 
  content: string;
  action: 'create' | 'write' | 'save'
} | null {
  // Simple pattern matching for now
  const patterns = [
    // Pattern: "Create a file named X with content Y"
    /create (?:a )?file (?:named )?["']?([^"'\n]+?)["']?(?: with (?:the )?content[s]? ?["']?(.+)["']?)?$/i,
    // Pattern: "Write content Y to file X"
    /write (?:the )?content[s]? ?["']?(.+)["']? to (?:a )?file (?:named )?["']?([^"'\n]+?)["']?$/i,
    // Pattern: "Save content Y to file X"
    /save (?:the )?content[s]? ?["']?(.+)["']? to (?:a )?file (?:named )?["']?([^"'\n]+?)["']?$/i,
    // Pattern: "Make a file named X with content Y"
    /make (?:a )?file (?:named )?["']?([^"'\n]+?)["']?(?: with (?:the )?content[s]? ?["']?(.+)["']?)?$/i,
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      if (pattern.toString().includes('write') || pattern.toString().includes('save')) {
        // Pattern: write/save content to file
        return {
          action: pattern.toString().includes('save') ? 'save' : 'write',
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
async function handleFileOperation(message: string): Promise<{ 
  success: boolean; 
  response: string; 
  path?: string 
} | null> {
  // Check if this is a file operation request
  if (!isFileOperationRequest(message)) {
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
        response: 'File writing skill not available at current trust level'
      };
    }
    
    // Sanitize filename and create safe path
    const safeFilename = path.basename(details.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = path.join(ROOT, 'out', safeFilename);
    
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

// ====================================================================================================
// Original Persona Chat Types and Constants
// ====================================================================================================

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';

// Simple in-memory histories per mode
const histories: Record<Mode, Array<{ role: Role; content: string }>> = {
  inner: [],
  conversation: [],
};

// ... (rest of the original file content continues below)