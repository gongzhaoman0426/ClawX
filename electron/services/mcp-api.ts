import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { McpServerInput, McpTransport } from '@shared/types/mcp';
import {
  addMcpServer,
  listMcpServers,
  removeMcpServer,
  toggleMcpServer,
  updateMcpServer,
} from '../utils/mcp-config';
import { isRecord } from './payload-utils';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getName(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw new Error('name is required');
  }
  return body.name.trim();
}

function getTransport(value: unknown): McpTransport {
  if (value === 'stdio' || value === 'sse' || value === 'streamable-http') {
    return value;
  }
  throw new Error('transport must be stdio, sse, or streamable-http');
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function getServerInput(payload: unknown): McpServerInput {
  const body = isRecord(payload) ? payload : {};
  const rawServer = isRecord(body.server) ? body.server : body;
  if (typeof rawServer.name !== 'string') {
    throw new Error('server.name is required');
  }
  return {
    name: rawServer.name,
    transport: getTransport(rawServer.transport),
    enabled: typeof rawServer.enabled === 'boolean' ? rawServer.enabled : undefined,
    command: typeof rawServer.command === 'string' ? rawServer.command : undefined,
    args: Array.isArray(rawServer.args)
      ? rawServer.args.filter((item): item is string => typeof item === 'string')
      : undefined,
    env: getStringRecord(rawServer.env),
    cwd: typeof rawServer.cwd === 'string' ? rawServer.cwd : undefined,
    url: typeof rawServer.url === 'string' ? rawServer.url : undefined,
    headers: getStringRecord(rawServer.headers),
  };
}

function getOriginalName(payload: unknown): string | undefined {
  const body = isRecord(payload) ? payload : {};
  return typeof body.originalName === 'string' && body.originalName.trim()
    ? body.originalName.trim()
    : undefined;
}

export function createMcpApi(): CompleteHostServiceRegistry['mcp'] {
  return {
    list: async () => ({ success: true, servers: await listMcpServers() }),
    add: async (payload) => {
      try {
        const servers = await addMcpServer(getServerInput(payload));
        return { success: true, servers };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    update: async (payload) => {
      try {
        const servers = await updateMcpServer(getServerInput(payload), getOriginalName(payload));
        return { success: true, servers };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    toggle: async (payload) => {
      try {
        const enabled = isRecord(payload) ? payload.enabled : undefined;
        if (typeof enabled !== 'boolean') {
          throw new Error('enabled is required');
        }
        const servers = await toggleMcpServer(getName(payload), enabled);
        return { success: true, servers };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    remove: async (payload) => {
      try {
        const servers = await removeMcpServer(getName(payload));
        return { success: true, servers };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
