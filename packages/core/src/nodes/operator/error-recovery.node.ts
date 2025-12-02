/**
 * Error Recovery Node
 *
 * Provides smart retry suggestions based on error type and context
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, properties) => {
  const error = inputs[0]?.error || inputs[0] || '';
  const skillId = inputs[0]?.skillId || '';
  const maxRetries = properties?.maxRetries || 3;
  const retryCount = inputs[0]?.retryCount || 0;

  try {
    // Categorize error type
    let errorType = 'UNKNOWN';
    let suggestions: string[] = [];

    const errorStr = String(error).toLowerCase();

    // Check for path restriction errors (most specific first)
    if (errorStr.includes('path_not_allowed') || errorStr.includes('write not allowed')) {
      errorType = 'PATH_RESTRICTED';
      const match = String(error).match(/allowed:\s*([^.]+)/i);
      if (match) {
        const allowedDirs = match[1].trim();
        suggestions = [
          `This path is restricted. Use one of these directories: ${allowedDirs}`,
          `Do NOT retry with the same path - it will always fail`,
          `Use conversational_response to explain the restriction to the user`,
        ];
      } else {
        suggestions = [
          `This path is restricted by security policy`,
          `Check the skill's allowedDirectories in the manifest`,
          `Use conversational_response to explain the restriction to the user`,
        ];
      }
    } else if (errorStr.includes('failed validation')) {
      errorType = 'VALIDATION_FAILED';
      suggestions = [
        `The input parameters don't meet requirements`,
        `Check the skill manifest for parameter constraints`,
        `Do NOT retry with the same inputs`,
        `Use conversational_response to explain the validation error to the user`,
      ];
    } else if (errorStr.includes('not found') || errorStr.includes('enoent')) {
      errorType = 'FILE_NOT_FOUND';
      suggestions = [
        `Try using fs_list to check what files are available`,
        `Verify the file path is correct`,
        `Check if the file exists in a different directory`,
      ];
    } else if (errorStr.includes('permission') || errorStr.includes('eacces')) {
      errorType = 'PERMISSION_DENIED';
      suggestions = [
        `Check file permissions`,
        `Try accessing with different user privileges`,
        `Verify you have write access to the directory`,
      ];
    } else if (errorStr.includes('invalid') || errorStr.includes('parse')) {
      errorType = 'INVALID_ARGS';
      suggestions = [
        `Check the format of your input arguments`,
        `Verify JSON syntax if passing JSON data`,
        `Review the skill's required parameters`,
      ];
    } else if (errorStr.includes('timeout')) {
      errorType = 'TIMEOUT';
      suggestions = [
        `Retry the operation`,
        `Break the task into smaller steps`,
        `Check if the service is responsive`,
      ];
    } else if (errorStr.includes('network') || errorStr.includes('connection')) {
      errorType = 'NETWORK_ERROR';
      suggestions = [
        `Check network connectivity`,
        `Retry after a brief delay`,
        `Verify the service endpoint is accessible`,
      ];
    }

    // Determine if we should retry
    // ONLY retry transient errors (timeouts, network issues, invalid args)
    // DO NOT retry: PATH_RESTRICTED, VALIDATION_FAILED, PERMISSION_DENIED, FILE_NOT_FOUND
    const shouldRetry = retryCount < maxRetries && (
      errorType === 'TIMEOUT' ||
      errorType === 'NETWORK_ERROR' ||
      errorType === 'INVALID_ARGS'
    );

    return {
      errorType,
      suggestions,
      shouldRetry,
      retryCount: retryCount + 1,
      error,
      skillId,
    };
  } catch (err) {
    console.error('[ErrorRecovery] Error:', err);
    return {
      errorType: 'UNKNOWN',
      suggestions: [],
      shouldRetry: false,
      retryCount,
      error: (err as Error).message,
    };
  }
};

export const ErrorRecoveryNode: NodeDefinition = defineNode({
  id: 'error_recovery',
  name: 'Error Recovery',
  category: 'operator',
  inputs: [
    { name: 'error', type: 'string' },
    { name: 'skillId', type: 'string', optional: true },
  ],
  outputs: [
    { name: 'errorType', type: 'string', description: 'Categorized error type' },
    { name: 'suggestions', type: 'array', description: 'Recovery suggestions' },
    { name: 'shouldRetry', type: 'boolean' },
  ],
  properties: {
    maxRetries: 3,
  },
  propertySchemas: {
    maxRetries: {
      type: 'number',
      default: 3,
      label: 'Max Retries',
      description: 'Maximum retry attempts',
    },
  },
  description: 'Provides smart retry suggestions based on error type',
  execute,
});
