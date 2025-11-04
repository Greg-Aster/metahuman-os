
# Guide: Setting Up the Local AI Agent with Ollama

**Objective**: Modify and run the `organizer.ts` agent to use a local Large Language Model (LLM) via Ollama for automatically tagging and identifying entities in new memories.

---

## Prerequisites

1.  **Ollama Installed**: The Ollama server is installed and accessible.
2.  **Model Downloaded**: You have a suitable model downloaded. A good, fast model for this task is `llama3:8b`.
    ```bash
    # If you haven't already, pull the model
    ollama pull llama3:8b
    ```
3.  **Node.js Environment**: The project dependencies are installed (`pnpm install`).

---

## Step 1: Update the Agent's Brain (`analyzeMemoryContent`)

The current `organizer.ts` file has a placeholder for AI logic. You need to replace it with code that calls your local Ollama API.

**File to Edit**: `brain/agents/organizer.ts`

**Action**: Replace the entire `analyzeMemoryContent` function with the following code. This new version will call the local Ollama server and parse its JSON response.

```typescript
/**
 * Uses a local LLM via Ollama to analyze the content of a memory and extract tags and entities.
 * @param content The text content of the memory.
 * @returns A promise that resolves to an object with tags and entities.
 */
async function analyzeMemoryContent(content: string): Promise<{ tags: string[]; entities: string[] }> {
  console.log(`[Ollama] Analyzing content: "${content.substring(0, 50)}..."`);

  const OLLAMA_ENDPOINT = 'http://localhost:11434/api/chat';

  const prompt = `You are an expert text analysis agent. Your task is to extract key tags and named entities from the following text. 

Respond with ONLY a valid JSON object in the format: {"tags": ["tag1", "tag2"], "entities": ["entity1", "entity2"]}.

Do not include any other text, explanation, or markdown formatting. The JSON object must be the only thing in your response.

Text to analyze:
---
${content}
---
`;

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "llama3:8b", // Or your preferred model
        messages: [{ role: "user", content: prompt }],
        format: "json", // Request JSON output from Ollama
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API request failed with status ${response.status}`);
    }

    const responseData = await response.json();
    const messageContent = responseData.message.content;
    
    // The response from Ollama with format: "json" is a JSON string.
    const parsed = JSON.parse(messageContent);

    return {
      tags: parsed.tags || [],
      entities: parsed.entities || [],
    };

  } catch (error) {
    console.error('[Ollama] Error analyzing memory:', error);
    // Return empty arrays on error to avoid halting the process
    return { tags: [], entities: [] };
  }
}
```

---

## Step 2: Ensure Ollama Server is Running

For the agent to work, the Ollama server must be running and accessible. 

1.  **Open a new terminal** on the machine where Ollama is installed.
2.  Run the following command to start the server:
    ```bash
    ollama serve
    ```
3.  Keep this terminal open. You should see logs indicating the server is listening for requests.

*Note: If Ollama is configured to run as a system service (e.g., on Linux or macOS), it may already be running in the background.*

---

## Step 3: Run the Organizer Agent

With the code updated and the server running, you can now execute the agent.

1.  **Open another terminal** in the `metahuman` project root.
2.  Use the `tsx` runner (installed as a project dependency) to execute the agent script:
    ```bash
    pnpm tsx ./brain/agents/organizer.ts
    ```

---

## Step 4: Verify the Outcome

When the agent runs, you should see output in your terminal similar to this:

```
🤖 Starting Organizer Agent...
Found 2 memories to process.
[Ollama] Analyzing content: "Initial conversation with Gemini about bootstrappi..."
✓ Updated evt-202510191627009-initial-conversation-with-gemini-about-bootstrappi.json
[Ollama] Analyzing content: "Testing the integrated audit system..."
✓ Updated evt-202510191621123-testing-integrated-audit-system.json
Organizer Agent finished its run. ✅
```

To confirm it worked, you can open one of the updated JSON files (e.g., in `memory/episodic/2025/`) and see that the `tags` and `entities` arrays are now populated with relevant values.

---

## Troubleshooting

-   **Connection Refused Error**: This almost always means the Ollama server is not running or is not accessible at `http://localhost:11434`. Double-check Step 2.
-   **JSON Parsing Error**: If the model doesn't perfectly follow instructions and returns text other than the JSON object, parsing will fail. The `llama3:8b` model is generally very good with the `format: "json"` option, but if issues persist, you may need to refine the prompt in the `analyzeMemoryContent` function.
-   **No Memories Found**: Ensure you have `.json` files in the `memory/episodic/` directory with empty `tags` or `entities` arrays.

