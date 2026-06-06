# PR #90328 visual proof

Visual proof for openclaw/openclaw#90328.

- Branch under test: `agent/xiaozhua/model-runtime-observability`
- Head: `5e26af0e01275904a90e7982d817168f0d422994`
- UI served from the PR branch via `pnpm dev:ui:mock -- --host 127.0.0.1 --port 5193`
- Mock gateway model catalog entry included `id: "openai/gpt-5.5"` and `agentRuntime: { id: "codex", label: "OpenAI Codex", source: "configured" }`
- Screenshot shows the Chat model picker option rendered as `GPT-5.5 · OpenAI Codex`.
- Final-head generated protocol verification also passed with `CI=true pnpm protocol:check`.

Image: `model-picker-openai-codex.png`
