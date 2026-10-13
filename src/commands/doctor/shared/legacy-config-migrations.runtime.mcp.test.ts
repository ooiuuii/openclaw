import { describe, expect, it } from "vitest";
import { LEGACY_CONFIG_MIGRATIONS_RUNTIME_MCP } from "./legacy-config-migrations.runtime.mcp.js";

describe.each(["mcp.servers", "nodeHost.mcp.servers"])("%s mixed transport migration", (path) => {
  it.each([true, false])(
    "preserves requester-scoped entries for manual repair (auth present: %s)",
    (authPresent) => {
      const original = {
        command: "node",
        args: ["requester-mcp.mjs"],
        url: "https://mcp.example.com/mcp",
        transport: "streamable-http",
        ...(authPresent ? { auth: "oauth" } : {}),
        oauth: { identity: "per-requester", scope: "docs.read" },
        headers: { "X-Test": "value" },
        sslVerify: false,
        clientCert: "cert.pem",
        clientKey: "key.pem",
      };
      const servers: Record<string, Record<string, unknown>> = {
        requester: structuredClone(original),
      };
      const raw =
        path === "mcp.servers" ? { mcp: { servers } } : { nodeHost: { mcp: { servers } } };
      const migrate = () => {
        const changes: string[] = [];
        for (const migration of LEGACY_CONFIG_MIGRATIONS_RUNTIME_MCP) {
          migration.apply(raw, changes);
        }
        return changes;
      };

      expect(migrate()).toEqual([]);
      expect(servers.requester).toEqual(original);
      const issues = LEGACY_CONFIG_MIGRATIONS_RUNTIME_MCP.flatMap(
        (migration) => migration.legacyRules ?? [],
      )
        .filter((rule) => rule.path.join(".") === path && rule.match?.(servers, raw))
        .map((rule) => rule.message);
      expect(issues).toEqual([expect.stringMatching(/per-requester.*manual repair/)]);

      servers.shared = { command: "shared-mcp", url: "https://shared.example.com/mcp" };
      expect(migrate()).toEqual([
        `Preserved historical stdio behavior for ${path}.shared by removing HTTP-only fields: url.`,
      ]);
      expect(servers.shared).toEqual({ command: "shared-mcp" });
      expect(servers.requester).toEqual(original);
      expect(migrate()).toEqual([]);
      expect(servers.requester).toEqual(original);
    },
  );
});
