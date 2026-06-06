# PR #90328 current-head proof

Current PR head: `e894e4b110c7563844d16ed4a006e28972dece8a`

This artifact proves the current #90328 head after the alias-preservation rebase.

## Files

- `model-picker-openai-codex-current-head.png` — current-head Control UI mock WebUI screenshot showing the Chat model picker option `gpt-5.5 · OpenAI Codex`.
- `models-list-current-head.json` — current-head Gateway model metadata helper output showing canonical `id: "gpt-5.5"`, `provider: "openai"`, and `agentRuntime: { id: "codex", source: "model", label: "OpenAI Codex" }`.

## Environment

- Source checkout: `/tmp/openclaw-pr-90328-update`
- Branch: `agent/xiaozhua/model-runtime-observability`
- Head: `e894e4b110c7563844d16ed4a006e28972dece8a`
- Mock WebUI server: `pnpm dev:ui:mock -- --host 127.0.0.1 --port 5193` (Vite bound `5194` because `5193` was occupied)
- Screenshot automation: system Google Chrome via Playwright, no production Gateway involved.

## Commands

```bash
cd /tmp/openclaw-pr-90328-update
git rev-parse HEAD
# e894e4b110c7563844d16ed4a006e28972dece8a

pnpm dev:ui:mock -- --host 127.0.0.1 --port 5193
# Open /chat?session=main, open the Chat model picker, verify `gpt-5.5 · OpenAI Codex`.

node --import tsx /tmp/pr90328-current-head-proof/models-list-current-head.mjs
```

The temporary mock catalog entry used for the screenshot supplied:

```json
{
  "id": "gpt-5.5",
  "name": "gpt-5.5",
  "provider": "openai",
  "agentRuntime": { "id": "codex", "label": "OpenAI Codex", "source": "configured" }
}
```

The PR worktree was restored after capture; these proof files live only on this proof branch.
