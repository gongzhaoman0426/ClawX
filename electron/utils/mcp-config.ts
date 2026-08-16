/**
 * MCP Config Utilities
 * Read and mutate OpenClaw-managed `mcp.servers` entries.
 */
import { mutateOpenClawConfig, readOpenClawConfigSnapshot } from '../gateway/config-delivery';
import type { McpServer, McpServerInput, McpTransport } from '@shared/types/mcp';

type RawServer = Record<string, unknown>;

interface OpenClawConfig {
  mcp?: {
    servers?: Record<string, RawServer>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const NAME_MAX_LENGTH = 64;

function isRecord(value: unknown): value is RawServer {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function normalizeMcpName(value: string): string {
  return value.trim();
}

export function validateMcpName(name: string): string {
  const normalized = normalizeMcpName(name);
  if (!normalized) {
    throw new Error('MCP server name is required');
  }
  if (normalized.length > NAME_MAX_LENGTH) {
    throw new Error(`MCP server name must be at most ${NAME_MAX_LENGTH} characters`);
  }
  if (/[\\/]/.test(normalized)) {
    throw new Error('MCP server name cannot contain path separators');
  }
  return normalized;
}

export function resolveMcpTransport(raw: RawServer): McpTransport {
  const transport = typeof raw.transport === 'string' ? raw.transport.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (transport === 'stdio' || transport === 'sse' || transport === 'streamable-http') {
    return transport;
  }
  if (type === 'stdio') return 'stdio';
  if (type === 'sse') return 'sse';
  if (type === 'http' || type === 'streamable-http') return 'streamable-http';
  if (typeof raw.url === 'string' && raw.url.trim()) {
    return 'streamable-http';
  }
  return 'stdio';
}

function toMcpServer(name: string, raw: RawServer): McpServer {
  return {
    name,
    transport: resolveMcpTransport(raw),
    enabled: raw.enabled !== false,
    command: typeof raw.command === 'string' ? raw.command : undefined,
    args: getStringArray(raw.args),
    env: getStringRecord(raw.env),
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    headers: getStringRecord(raw.headers),
  };
}

function validateServerInput(input: McpServerInput): McpServerInput {
  const name = validateMcpName(input.name);
  const transport = input.transport;
  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'streamable-http') {
    throw new Error('Unsupported MCP transport');
  }

  if (transport === 'stdio') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) {
      throw new Error('stdio MCP servers require a command');
    }
    return {
      ...input,
      name,
      transport,
      command,
      args: input.args?.map((item) => item.trim()).filter(Boolean),
      cwd: typeof input.cwd === 'string' && input.cwd.trim() ? input.cwd.trim() : undefined,
      env: input.env,
      url: undefined,
      headers: undefined,
    };
  }

  const url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) {
    throw new Error(`${transport} MCP servers require a URL`);
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Remote MCP URL must start with http:// or https://');
  }
  return {
    ...input,
    name,
    transport,
    url,
    headers: input.headers,
    command: undefined,
    args: undefined,
    env: undefined,
    cwd: undefined,
  };
}

function toStoredServer(input: McpServerInput, existing?: RawServer): RawServer {
  const next: RawServer = { ...(existing || {}) };
  next.transport = input.transport;
  next.enabled = input.enabled !== false;
  delete next.type;

  if (input.transport === 'stdio') {
    next.command = input.command;
    if (input.args?.length) next.args = input.args;
    else delete next.args;
    if (input.cwd) next.cwd = input.cwd;
    else delete next.cwd;
    if (input.env && Object.keys(input.env).length > 0) next.env = input.env;
    else delete next.env;
    delete next.url;
    delete next.headers;
    return next;
  }

  next.url = input.url;
  if (input.headers && Object.keys(input.headers).length > 0) next.headers = input.headers;
  else delete next.headers;
  delete next.command;
  delete next.args;
  delete next.cwd;
  delete next.env;
  return next;
}

function getServers(config: OpenClawConfig): Record<string, RawServer> {
  if (!config.mcp) config.mcp = {};
  if (!config.mcp.servers || !isRecord(config.mcp.servers)) {
    config.mcp.servers = {};
  }
  return config.mcp.servers;
}

function findServerKey(servers: Record<string, RawServer>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.keys(servers).find((key) => key.toLowerCase() === target);
}

function listFromConfig(config: OpenClawConfig): McpServer[] {
  const servers = config.mcp?.servers;
  if (!isRecord(servers)) return [];
  return Object.entries(servers)
    .filter((entry): entry is [string, RawServer] => isRecord(entry[1]))
    .map(([name, raw]) => toMcpServer(name, raw))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listMcpServers(): Promise<McpServer[]> {
  try {
    const snapshot = await readOpenClawConfigSnapshot();
    return listFromConfig(snapshot.config as OpenClawConfig);
  } catch (error) {
    console.error('Failed to read MCP servers:', error);
    return [];
  }
}

export async function addMcpServer(input: McpServerInput): Promise<McpServer[]> {
  const server = validateServerInput(input);
  await mutateOpenClawConfig((config) => {
    const servers = getServers(config as OpenClawConfig);
    if (findServerKey(servers, server.name)) {
      throw new Error(`MCP server "${server.name}" already exists`);
    }
    servers[server.name] = toStoredServer(server);
  });
  return listMcpServers();
}

export async function updateMcpServer(
  input: McpServerInput,
  originalName?: string,
): Promise<McpServer[]> {
  const server = validateServerInput(input);
  const sourceName = originalName ? validateMcpName(originalName) : server.name;
  await mutateOpenClawConfig((config) => {
    const servers = getServers(config as OpenClawConfig);
    const existingKey = findServerKey(servers, sourceName);
    if (!existingKey) {
      throw new Error(`MCP server "${sourceName}" was not found`);
    }
    if (server.name.toLowerCase() !== existingKey.toLowerCase()) {
      const conflict = findServerKey(servers, server.name);
      if (conflict) {
        throw new Error(`MCP server "${server.name}" already exists`);
      }
    }
    const stored = toStoredServer(server, servers[existingKey]);
    if (existingKey !== server.name) {
      delete servers[existingKey];
    }
    servers[server.name] = stored;
  });
  return listMcpServers();
}

export async function toggleMcpServer(name: string, enabled: boolean): Promise<McpServer[]> {
  const target = validateMcpName(name);
  await mutateOpenClawConfig((config) => {
    const servers = getServers(config as OpenClawConfig);
    const existingKey = findServerKey(servers, target);
    if (!existingKey) {
      throw new Error(`MCP server "${target}" was not found`);
    }
    servers[existingKey] = {
      ...servers[existingKey],
      enabled,
    };
  });
  return listMcpServers();
}

export async function removeMcpServer(name: string): Promise<McpServer[]> {
  const target = validateMcpName(name);
  await mutateOpenClawConfig((config) => {
    const servers = getServers(config as OpenClawConfig);
    const existingKey = findServerKey(servers, target);
    if (!existingKey) {
      throw new Error(`MCP server "${target}" was not found`);
    }
    delete servers[existingKey];
  });
  return listMcpServers();
}
