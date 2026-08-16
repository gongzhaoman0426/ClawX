/**
 * MCP server definitions stored under OpenClaw `mcp.servers`.
 * Transports match OpenClaw: stdio, sse, streamable-http.
 */

export const MCP_TRANSPORTS = ['stdio', 'sse', 'streamable-http'] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpServer {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}
