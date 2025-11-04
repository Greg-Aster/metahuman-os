# Web Search Skill

## Overview
The autonomous operator performs live web lookups via the `web_search` skill. Primary coverage comes from **Brave Search API** (privacy-focused, low filtering). If Brave returns no results or the API key is missing, the skill falls back to DuckDuckGo's instant answers, and finally to TheCatAPI for a friendly image when nothing else is available.

## Configuration
- Allowed host list lives in `etc/network.json`. We ship with `api.search.brave.com`, `api.duckduckgo.com`, and `api.thecatapi.com` enabled; add additional providers here if needed.
- Minimum trust level defaults to `supervised_auto`. Lowering this value increases risk—change only if you understand the implications.
- Brave Search requires an API key. Set `BRAVE_SEARCH_API_KEY` in your environment (e.g., `.env`, systemd unit, or shell export) before starting the CLI/agent.

## Usage
- Planner automatically prefers `web_search` when the task profile is `web` or when wording implies an internet lookup. Synonyms such as `websearch` and `search_web` map to the same skill.
- Operators still have access to `http_get` for direct fetches, but `web_search` should be the first step for open-ended queries.
- Results include the `source` field (`brave`, `duckduckgo`, or `thecatapi-fallback`) so you know which backend produced the data.
- Responses stream to the client like any other skill result, including audit logging.

## Extensibility
- To switch providers, adjust the request URL inside `brain/skills/web_search.ts` and add the host to `etc/network.json`.
- For richer results (images, news, etc.), extend the post-processing section or chain follow-up `http_get` calls.
