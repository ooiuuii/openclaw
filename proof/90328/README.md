# PR #90328 real PR-head Gateway/WebUI proof

Current PR head verified: `bc62b391bf7f7c9e6ea722c5fd746ded2a5da612` (`docs(gateway): document model runtime metadata`).

This proof was regenerated on 2026-06-08 from an actual temporary PR-head Gateway and the real Control UI served by that Gateway. It does not reuse the earlier screenshot and does not depend on the model-picker helper/mock path.

## Real behavior proof

Temporary setup:

- Repo/commit: `openclaw/openclaw` PR #90328 head `bc62b391bf7f7c9e6ea722c5fd746ded2a5da612`.
- Built/ran with source CLI: `OpenClaw 2026.6.2 (bc62b39)`.
- Isolated profile/home: `/tmp/openclaw-pr90328-proof/home`, profile `pr90328proof`.
- Gateway URL: `http://127.0.0.1:19129`.
- Channels skipped with `OPENCLAW_SKIP_CHANNELS=1`; the only runtime plugin loaded was `codex`.
- Auth/token secrets were not required. The configured test model intentionally reports `available: false`; availability is not relevant to the picker metadata behavior.

Artifacts:

- [`models-list-pr-head-real-gateway-20260608.json`](./models-list-pr-head-real-gateway-20260608.json) — actual `models.list` response from the temporary PR-head Gateway using `view: "configured"`.
- [`models-list-pr-head-gpt55-row-20260608.json`](./models-list-pr-head-gpt55-row-20260608.json) — filtered row for `openai/gpt-5.5`, showing canonical OpenAI provider/model plus separate Codex runtime metadata.
- [`pr-head-webui-picker-dropdown-20260608.png`](./pr-head-webui-picker-dropdown-20260608.png) — actual Control UI screenshot from the same temporary PR-head Gateway. The chat model picker is open and displays `GPT-5.5 · OpenAI Codex`.
- [`pr-head-real-run-config-20260608.json`](./pr-head-real-run-config-20260608.json) — minimal isolated config used for the proof run.

Actual Gateway row excerpt:

```json
{
  "id": "gpt-5.5",
  "name": "GPT-5.5",
  "provider": "openai",
  "api": "openai-responses",
  "available": false,
  "agentRuntime": {
    "id": "codex",
    "source": "model",
    "label": "OpenAI Codex"
  }
}
```

Actual WebUI evidence:

- Browser opened the real PR-head Control UI at `http://127.0.0.1:19129/chat?session=agent%3Amain%3Amain`.
- Accessibility snapshot of the open picker included selected option text: `GPT-5.5 · OpenAI Codex`.
- Playwright/CDP screenshot capture from that tab reported the visible label text: `GPT-5.5 · OpenAI Codex · Medium`.

## Supporting checks from current head

These checks were also rerun on the same PR head during the earlier current-head refresh:

```text
node --import tsx /tmp/pr90328-current-head-proof/models-list-current-head.mjs
# emitted models-list-current-head.json for head bc62b391bf7f7c9e6ea722c5fd746ded2a5da612

node scripts/run-vitest.mjs src/gateway/server-methods/models-list-result.test.ts ui/src/ui/chat-model-ref.test.ts --testNamePattern="models.list|agentRuntime|label|alias|OpenAI Codex"
# gateway models-list-result: 10 passed
# ui chat-model-ref focused group: 6 passed / 19 skipped

pnpm exec oxfmt --check docs/gateway/protocol.md
git diff --check
# docs protocol formatting and diff checks passed
```

Older artifacts remain in this directory for comparison, but the 2026-06-08 artifacts above are the real PR-head Gateway/WebUI proof requested by the latest review.
