import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import { createEmbeddingService } from "./embeddings.js";
import { insertItem, getUserItems, deactivateItem, searchMatches } from "./db.js";
import { requireUserId, type ToolExtra } from "./auth.js";
import { toSynapseItem, toSynapseMatch } from "./protocol.js";

/**
 * agora-mcp — Stage 0 server (see docs/architecture.md).
 *
 * Auth: Stage 0 is invite-only. Each call must carry
 * `Authorization: Bearer <token>` for a token the founder issued and
 * stored (hashed) in `users.token_hash` — see src/auth.ts.
 *
 * Tool output is shaped to the shared `synapse/v0` schema
 * (docs/synapse-protocol.md) so results are interoperable with the rest
 * of the author's project ecosystem (mcp-server's own `synapse` module
 * in particular), even though this server's internal DB schema is its
 * own (Postgres + pgvector, TypeScript).
 */

const embeddingService = createEmbeddingService();

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function getServer() {
  const server = new McpServer({
    name: "agora-mcp",
    version: "0.0.1",
  });

  server.registerTool(
    "submit_offer",
    {
      title: "Submit an offer",
      description: "Publish something the user has to offer.",
      inputSchema: {
        text: z.string().describe("Free-form description, in the user's own words"),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        geo: z.string().optional().describe("Free-form location string for hybrid filtering"),
      },
    },
    async ({ text, category, tags, geo }, extra: ToolExtra) => {
      try {
        const userId = await requireUserId(extra);
        const embedding = await embeddingService.embed(text, "offer");
        const itemId = await insertItem({ userId, type: "offer", text, category, tags, geo, embedding });
        return jsonResult({ item_id: itemId });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "submit_want",
    {
      title: "Submit a want",
      description: "Publish something the user is looking for.",
      inputSchema: {
        text: z.string().describe("Free-form description, in the user's own words"),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        geo: z.string().optional().describe("Free-form location string for hybrid filtering"),
      },
    },
    async ({ text, category, tags, geo }, extra: ToolExtra) => {
      try {
        const userId = await requireUserId(extra);
        const embedding = await embeddingService.embed(text, "want");
        const itemId = await insertItem({ userId, type: "want", text, category, tags, geo, embedding });
        return jsonResult({ item_id: itemId });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "search_matches",
    {
      title: "Search for matches",
      description: "Find candidate matches for one of the user's items.",
      inputSchema: {
        item_id: z.string().describe("Item to search matches for"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ item_id, limit }, extra: ToolExtra) => {
      try {
        await requireUserId(extra); // authenticated, but any caller may query matches for a public item_id
        const rows = await searchMatches({ itemId: item_id, limit: limit ?? 10 });
        return jsonResult({ matches: rows.map(toSynapseMatch) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_my_items",
    {
      title: "List my items",
      description: "List the calling user's own active offers/wants.",
      inputSchema: {},
    },
    async (_args, extra: ToolExtra) => {
      try {
        const userId = await requireUserId(extra);
        const rows = await getUserItems(userId);
        return jsonResult({ items: rows.map(toSynapseItem) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "deactivate_item",
    {
      title: "Deactivate an item",
      description: "Mark an offer/want as inactive (withdrawn, fulfilled, no longer relevant).",
      inputSchema: {
        item_id: z.string(),
      },
    },
    async ({ item_id }, extra: ToolExtra) => {
      try {
        const userId = await requireUserId(extra);
        await deactivateItem(userId, item_id);
        return jsonResult({ ok: true });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3010);

// Stateless mode (sessionIdGenerator: undefined): a fresh McpServer +
// transport is created per request. This is the pattern the SDK's own
// examples use for stateless StreamableHTTP servers and avoids one
// client's session state leaking into another's.
const app = createMcpExpressApp({ host: HOST });

app.post("/mcp", async (req, res) => {
  const server = getServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null })
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "agora-mcp", stage: 0 });
});

app.listen(PORT, HOST, () => {
  console.log(`agora-mcp Stage 0 server listening on http://${HOST}:${PORT}/mcp`);
  if (process.env.EMBEDDING_PROVIDER === undefined) {
    console.warn(
      "EMBEDDING_PROVIDER is not set — submit_offer/submit_want will error until you set it " +
        "(see src/embeddings.ts)."
    );
  }
});

process.on("SIGINT", async () => {
  console.log("Shutting down agora-mcp server...");
  process.exit(0);
});
