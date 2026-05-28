// Cockpit MCP server — Streamable HTTP transport with session management.
// Endpoint: http://localhost:<MCP_PORT>/mcp  (POST to call, GET for the SSE
// stream, DELETE to end a session). This is the spec-compliant mode every MCP
// client (Claude, Cursor, the SDK client, …) speaks.

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";
import { apiClient } from "./apiClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", "..", ".env") });

const PORT = Number(process.env.MCP_PORT || 8788);

function buildServer() {
  const server = new McpServer({ name: "cockpit", version: "1.0.0" });
  registerTools(server);
  return server;
}

// sessionId -> transport
const transports = {};
const isInitialize = (body) =>
  (Array.isArray(body) ? body : [body]).some((m) => m && m.method === "initialize");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Plain (non-MCP) health endpoint for liveness checks.
app.get("/health", async (_req, res) => {
  let api = "unreachable";
  try { api = (await apiClient.health()).ok ? "ok" : "error"; } catch { /* keep unreachable */ }
  res.json({ ok: true, service: "cockpit-mcp", transport: "streamable-http", endpoint: "/mcp", sessions: Object.keys(transports).length, api });
});

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitialize(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => { transports[sid] = transport; },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const server = buildServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session ID (send 'initialize' first)" },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// GET = open SSE stream for an existing session; DELETE = terminate it.
async function handleSessionRequest(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}
app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(PORT, () => {
  console.log(`Cockpit MCP (streamable-http) ready on http://localhost:${PORT}/mcp`);
  console.log(`  -> proxying the Cockpit API at ${apiClient.base}`);
});
