/**
 * MCP State Store
 * Manages OpenClaw-managed MCP server definitions.
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { McpServer, McpServerInput } from '@/types/mcp';

interface McpState {
  servers: McpServer[];
  loading: boolean;
  error: string | null;
  fetchServers: () => Promise<void>;
  addServer: (input: McpServerInput) => Promise<void>;
  updateServer: (input: McpServerInput, originalName?: string) => Promise<void>;
  toggleServer: (name: string, enabled: boolean) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
}

function applyServers(servers: McpServer[] | undefined, fallback: McpServer[]): McpServer[] {
  return Array.isArray(servers) ? servers : fallback;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,

  fetchServers: async () => {
    if (get().servers.length === 0) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }

    try {
      const result = await hostApi.mcp.list();
      if (!result.success) {
        throw new Error(result.error || 'Failed to load MCP servers');
      }
      set({ servers: result.servers, loading: false, error: null });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  addServer: async (input) => {
    const result = await hostApi.mcp.add(input);
    if (!result.success) {
      throw new Error(result.error || 'Failed to add MCP server');
    }
    set({ servers: applyServers(result.servers, get().servers), error: null });
  },

  updateServer: async (input, originalName) => {
    const result = await hostApi.mcp.update(input, originalName);
    if (!result.success) {
      throw new Error(result.error || 'Failed to update MCP server');
    }
    set({ servers: applyServers(result.servers, get().servers), error: null });
  },

  toggleServer: async (name, enabled) => {
    const previous = get().servers;
    set({
      servers: previous.map((server) => (
        server.name === name ? { ...server, enabled } : server
      )),
    });
    try {
      const result = await hostApi.mcp.toggle(name, enabled);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update MCP server');
      }
      set({ servers: applyServers(result.servers, get().servers), error: null });
    } catch (error) {
      set({ servers: previous });
      throw error;
    }
  },

  removeServer: async (name) => {
    const result = await hostApi.mcp.remove(name);
    if (!result.success) {
      throw new Error(result.error || 'Failed to remove MCP server');
    }
    set({ servers: applyServers(result.servers, get().servers), error: null });
  },
}));
