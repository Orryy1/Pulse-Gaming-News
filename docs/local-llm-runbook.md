# Pulse Gaming local LLM runbook

Pulse now routes production LLM work through `lib/llm-client.js`.
By default the local `.env` is configured for an Ollama/OpenAI-compatible
endpoint:

```ini
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:11434/v1
LOCAL_LLM_MODEL=gemma3:4b
LOCAL_LLM_STRONG_MODEL=gemma3:12b
ANTHROPIC_API_KEY=placeholder
```

## Start the local model server

Install Ollama for Windows from:

https://ollama.com/download

Then run:

```powershell
ollama pull gemma3:4b
ollama pull gemma3:12b
ollama serve
```

If the desktop Ollama app is already running, `ollama serve` may say the
address is already in use. That is fine; verify the API instead:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

## Model choice

This machine has an RTX 4090 with 24 GB VRAM, so the current split is:

- `gemma3:4b` for cheap, frequent jobs: scripts, titles, comments, entity extraction and analytics.
- `gemma3:12b` for stronger editor-style calls that replaced former Sonnet usage.

If quality is not good enough, try:

```ini
LOCAL_LLM_MODEL=gemma3:12b
LOCAL_LLM_STRONG_MODEL=gemma3:27b
```

The 27B model is larger and slower, but the 4090 should be the right class of
hardware to test it.

## Paid API escape hatch

Anthropic is now opt-in only:

```ini
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Do not set those values unless you intentionally want Anthropic billing again.
