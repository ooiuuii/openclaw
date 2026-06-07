# PR #90328 current-head proof

Current PR head verified: `bc62b391bf7f7c9e6ea722c5fd746ded2a5da612` (`docs(gateway): document model runtime metadata`).

Evidence:

- `model-picker-openai-codex-current-head.png` — WebUI model picker visual proof showing `gpt-5.5 · OpenAI Codex`.
- `models-list-current-head.json` — current-head Gateway metadata helper output showing canonical `provider: "openai"`, canonical model id `gpt-5.5`, and separate runtime metadata `agentRuntime.id = "codex"` / `label = "OpenAI Codex"`.

Current-head checks rerun on 2026-06-07:

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

The screenshot artifact is the visual model-picker proof for the same `gpt-5.5 · OpenAI Codex` UI behavior; current-head runtime metadata and UI label/alias behavior were revalidated with the helper and focused tests above after the docs-only follow-up at `bc62b391bf7f7c9e6ea722c5fd746ded2a5da612`.
