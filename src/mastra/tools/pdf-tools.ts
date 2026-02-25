import { Composio } from '@composio/core';
import { MCPClient } from '@mastra/mcp';

let cachedTools: Awaited<ReturnType<MCPClient['getTools']>> | null = null;

/**
 * Creates a Composio MCP session for PDF.co and returns the tools.
 * Results are cached so subsequent calls reuse the same session.
 */
export async function getPdfTools() {
  if (cachedTools) return cachedTools;

  const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
  });

  const session = await composio.create(process.env.COMPOSIO_USER_ID!, {
    toolkits: ['pdf_co'],
  });

  const mcpClient = new MCPClient({
    id: process.env.COMPOSIO_USER_ID!,
    servers: {
      pdf_co: {
        url: new URL(session.mcp.url),
        requestInit: { headers: session.mcp.headers },
      },
    },
    timeout: 30_000,
  });

  cachedTools = await mcpClient.getTools();
  return cachedTools;
}
