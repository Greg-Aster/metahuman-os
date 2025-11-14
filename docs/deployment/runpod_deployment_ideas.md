
Perfect. Here’s a clean, handoff-style summary you can feed to your local LLM so it can write the actual code.

---

## Goal

Use RunPod as the remote GPU backend for MetaHuman/your Astro app, while keeping your local setup as the default. The app should be able to call either:

* local Ollama (free, default), or
* RunPod endpoint (paid, faster/bigger)
  based on config or user choice.

---

## 1. Define providers in config

Create a JSON/YAML config (e.g. `etc/providers.json`) like:

```json
{
  "defaultProvider": "local",
  "providers": {
    "local": {
      "type": "ollama",
      "baseUrl": "http://127.0.0.1:11434"
    },
    "runpod": {
      "type": "runpod",
      "endpoint": "https://api.runpod.ai/v2/<YOUR-POD-ID>/runsync",
      "apiKey": "ENV:RUNPOD_API_KEY",
      "model": "qwen2:latest"
    }
  }
}
```

Tell the local LLM: “read this file, and if a provider says `ENV:...`, load the value from process.env.”

---

## 2. Add a model/LLM resolver

In your Node/TS backend (the part the Astro site talks to), make a helper like:

```ts
async function callLLM(providerName, payload) {
  const config = loadProviders();
  const provider = config.providers[providerName];

  if (provider.type === "ollama") {
    // POST to local Ollama
  }

  if (provider.type === "runpod") {
    // POST to RunPod runsync with apiKey
  }
}
```

This lets you write the rest of the app in terms of:

```ts
const reply = await callLLM("runpod", userPrompt);
```

instead of hardcoding URLs.

---

## 3. Implement the RunPod call

RunPod pods usually take a JSON body like:

```json
{
  "input": {
    "prompt": "Your prompt here"
  }
}
```

and require a header:

```http
Authorization: Bearer <RUNPOD_API_KEY>
```

So tell your local LLM: “Create a function that POSTs to RunPod with fetch/axios, passes the prompt, and returns the model’s text.”

---

## 4. Expose a single API route for the frontend

Make an endpoint in your app, e.g. `/api/chat`:

* it accepts `{ provider: "local" | "runpod", messages: [...] }`
* if `provider` is missing, use the default from config
* call `callLLM(provider, messages)`
* return the response to the browser

That way your Astro UI can switch providers without knowing secrets.

---

## 5. Keep secrets out of GitHub

* Put `RUNPOD_API_KEY=...` in `.env`
* Make sure `.env` is in `.gitignore`
* In production (RunPod or whatever), set the env var in the dashboard

Tell your local LLM to “load dotenv and read RUNPOD_API_KEY.”

---

## 6. Optional: fallback logic

Add a small wrapper:

```ts
try {
  return await callLLM("local", payload);
} catch (e) {
  return await callLLM("runpod", payload);
}
```

So if your home box is offline, it uses RunPod.

---

## 7. Test flow

1. Call `/api/chat` with provider=`local` → should hit Ollama.
2. Call `/api/chat` with provider=`runpod` → should hit your RunPod pod.
3. Check logs on RunPod to confirm it received the job.

---

That’s the whole shape.
Give that to your local coding LLM and tell it: “Implement these helpers, generate TypeScript types, and integrate with my existing context builder before calling the provider.”
