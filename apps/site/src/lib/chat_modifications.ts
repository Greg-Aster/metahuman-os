// Add this import at the top of persona_chat.ts after the existing imports
import { handleFileOperation } from '../lib/file_operation_handler.js';

// Add this function after the existing shouldUseOperator function
async function checkAndHandleFileOperation(message: string) {
  // Check if this is a file operation request
  const fileOpResult = await handleFileOperation(message);
  if (fileOpResult) {
    // Return a streamed response like the operator
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const push = (type: string, data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\\n\\n`));
        };

        try {
          if (fileOpResult.success) {
            push('answer', { 
              response: fileOpResult.response + (fileOpResult.path ? `\\n\\n📁 File location: ${fileOpResult.path}` : '')
            });
          } else {
            push('answer', { 
              response: fileOpResult.response
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
  
  return null;
}

// Modify the handleChatRequest function to check for file operations first
// Add this at the beginning of handleChatRequest, right after the parameter validation:
async function handleChatRequest({ message, mode = 'inner', newSession = false, audience, length, reason, llm }) {
  const m: Mode = mode === 'conversation' ? 'conversation' : 'inner';

  // Log incoming message
  console.log(`[${new Date().toISOString()}] handleChatRequest: mode=${m}, message="${message}"`);

  // Check for file operations first
  const fileOpResponse = await checkAndHandleFileOperation(message);
  if (fileOpResponse) {
    return fileOpResponse;
  }

  // ... rest of existing handleChatRequest function
}