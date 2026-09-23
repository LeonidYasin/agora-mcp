import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { UnimplementedEmbeddingService } from "./embeddings.js";
import { insertItem, getUserItems, deactivateItem, searchMatches } from "./db.js";

/**
 * agora-mcp — Stage 0 server.
 *
 * Auth: each call is expected to resolve to a userId via whatever OAuth/
 * session mechanism sits in front of this server. That wiring is
 * intentionally left out of this scaffold — see docs/mcp-tools.md for the
 * intended contract.
 */

const embeddingService = new UnimplementedEmbeddingService();

function getUserIdFromContext(): string {
  // TODO: resolve from the authenticated MCP session / OAuth token.
  throw new Error("Auth wiring not implemented yet.");
}

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
    },
  },
  async ({ text, category, tags }) => {
    const userId = getUserIdFromContext();
    const embedding = await embeddingService.embed(text, "offer");
    const itemId = await insertItem({ userId, type: "offer", text, category, tags, embedding });
    return { content: [{ type: "text", text: JSON.stringify({ item_id: itemId }) }] };
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
    },
  },
  async ({ text, category, tags }) => {
    const userId = getUserIdFromContext();
    const embedding = await embeddingService.embed(text, "want");
    const itemId = await insertItem({ userId, type: "want", text, category, tags, embedding });
    return { content: [{ type: "text", text: JSON.stringify({ item_id: itemId }) }] };
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
  async ({ item_id, limit }) => {
    const matches = await searchMatches({ itemId: item_id, limit: limit ?? 10 });
    return { content: [{ type: "text", text: JSON.stringify({ matches }) }] };
  }
);

server.registerTool(
  "get_my_items",
  {
    title: "List my items",
    description: "List the calling user's own active offers/wants.",
    inputSchema: {},
  },
  async () => {
    const userId = getUserIdFromContext();
    const items = await getUserItems(userId);
    return { content: [{ type: "text", text: JSON.stringify({ items }) }] };
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
  async ({ item_id }) => {
    const userId = getUserIdFromContext();
    await deactivateItem(userId, item_id);
    return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
  }
);

// Minimal HTTP wiring — expand with real auth middleware before deploying.
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);

console.log("agora-mcp server scaffold ready (auth + HTTP listener not wired up yet)");
