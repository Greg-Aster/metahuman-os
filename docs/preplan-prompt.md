### 📋 Agent Instructions: Codebase Architecture Review

**Objective:**
You are an AI Code Review Agent. Your objective is to analyze the software project you are in to identify its key components, data flow, and architecture. This information will be used to plan the integration of a new multi-agent, multi-model system.

Your final output **must** be a structured JSON object containing your findings.

**Available Tools:**
You have access to the following tools. Use them to investigate the codebase. You *cannot* write or modify any files.

  * `list_files(directory_path: string)`: Lists files and sub-directories in a given path.
  * `read_file(file_path: string)`: Reads the full text content of a single file.
  * `search_code(search_query: string)`: Searches the entire codebase for a specific string or keyword and returns the file paths and line numbers of any matches.
  * `finish(report: json)`: Submits your final JSON report.

**Plan of Action:**
You must perform the following investigation steps. For each step, use your tools to find the answers and take notes for your final report.

**Step 1: Identify the Service Entrypoint**

  * **Goal:** Find how a user request (like a prompt) first enters the system.
  * **Actions:**
    1.  `list_files(directory_path: "./")` to see the root structure.
    2.  `read_file(file_path: "package.json")`. Analyze the `scripts` (like `dev`, `start`) and `main` fields to find the main entry script.
    3.  `read_file(file_path: "astro.config.mjs")` or `vite.config.ts` (if they exist) to check for server or API route configurations.
    4.  `search_code(search_query: "createApiRoute")` or `app.post(` or `app.get(`/api/`)` to find the exact API route definition files.
    5.  Record the file(s) that handle incoming HTTP requests.

**Step 2: Map the Core Logic**

  * **Goal:** Find the "brain" of the application—the main function that processes the user's request.
  * **Actions:**
    1.  Start from the file(s) you found in **Step 1**. `read_file()` on those files.
    2.  Follow the `import` statements. Look for imports from `src/core`, `src/lib`, `src/brain`, or `src/services`.
    3.  `search_code(search_query: "handleRequest")` or `processPrompt` to find the central processing function.
    4.  Record the file(s) and function name(s) that seem to contain the main business logic.

**Step 3: Discover Data & State Management**

  * **Goal:** Understand what data the application can read and write.
  * **Actions:**
    1.  `search_code(search_query: "node:fs")` or `fs.readFileSync` or `fs.writeFileSync` to find all files that perform file I/O.
    2.  `search_code(search_query: "paths.episodic")` or `paths.semantic` to see if a central `paths` object is used.
    3.  `search_code(search_query: "prisma")` or `db.query` or `new Sqlite` to check for any database connections.
    4.  Record the primary folders the app reads from and writes to.

**Step 4: Analyze the Environment**

  * **Goal:** Determine how the application and its AI models are hosted and run.
  * **Actions:**
    1.  `read_file(file_path: "Dockerfile")` or `docker-compose.yml` (if they exist) to understand the runtime container.
    2.  `search_code(search_query: "Ollama")` or `vLLM` or `HuggingFace` to find how AI models are being served or called.
    3.  Record how the application is started (from `package.json`) and how it communicates with the LLM.

**Step 5: Generate Final Report**

  * **Goal:** Consolidate all your findings into a single JSON object.
  * **Actions:**
    1.  Review all the information you have gathered.
    2.  Construct the final JSON report according to the format below.
    3.  Call the `finish(report: json)` tool with the completed report.

-----

### Final Report Format (JSON)

Your final call must be `finish()` with a JSON object that follows this *exact* structure:

```json
{
  "entrypoint": {
    "description": "How a user request enters the system.",
    "key_files": [
      "src/pages/api/prompt.ts",
      "package.json"
    ],
    "key_functions_or_scripts": {
      "package.json[scripts.dev]": "astro dev",
      "src/pages/api/prompt.ts": "POST"
    }
  },
  "core_logic": {
    "description": "The 'brain' of the application.",
    "key_files": [
      "src/core/agent.ts"
    ],
    "key_functions": [
      "handleRequest(prompt)"
    ],
    "import_chains": [
      "src/pages/api/prompt.ts -> src/core/agent.ts"
    ]
  },
  "data_management": {
    "description": "How the application reads/writes data.",
    "key_files": [
      "src/lib/paths.ts",
      "src/core/memory.ts"
    ],
    "patterns": [
      "Uses a central 'paths.ts' object.",
      "Reads from 'memory/episodic/' using fs.readFileSync.",
      "No database connection found."
    ]
  },
  "environment": {
    "description": "How the application is run and serves models.",
    "key_files": [
      "package.json",
      "docker-compose.yml"
    ],
    "patterns": [
      "Application is started with 'pnpm start'.",
      "Uses Docker to run the application.",
      "Communicates with an 'Ollama' service via HTTP requests."
    ]
  }
}
```

-----

Run this agent on your codebase. Once it provides the final JSON report, please share it with me. That report will give us the precise architectural map we need to plan the integration.