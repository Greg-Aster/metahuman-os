/**
 * Enhanced persona_chat API with file operation support
 */

import { isFileOperation, handleFileOperation } from '../lib/file_operations.js';
// ... (rest of the existing imports)

async function handleChatRequest({ message, mode = 'inner', newSession = false, audience, length, reason, llm }) {
  // ... (existing code until the routing logic)
  
  // Enhanced routing logic - check for file operations first
  if (isFileOperation(message)) {
    // Handle file operation directly
    const fileResult = await handleFileOperation(message);
    
    // Return the result as a streamed response like the operator
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const push = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        };

        try {
          if (fileResult.success) {
            push('answer', { 
              response: `✅ ${fileResult.response}\n\nFile created at: ${fileResult.path}` 
            });
          } else {
            push('answer', { 
              response: `❌ ${fileResult.response}` 
            });
          }
        } catch (error) {
          console.error('[persona_chat] File operation error:', error);
          push('error', { message: (error as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
  
  // Existing operator routing logic
  const useOperator = await shouldUseOperator(message);
  
  if (useOperator) {
    // ... (existing operator logic)
  }
  
  // ... (rest of existing chat logic)
}