/**
 * MCP Page
 * Add and manage OpenClaw-managed MCP servers (stdio / SSE / streamable-http).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Cable,
  FolderOpen,
  Globe,
  Plus,
  Radio,
  Search,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { hostApi } from '@/lib/host-api';
import { isGatewayStopped } from '@/lib/gateway-status';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useMcpStore } from '@/stores/mcp';
import type { McpServer, McpServerInput, McpTransport } from '@/types/mcp';

type StatusFilter = 'all' | 'enabled' | 'disabled';
type EditorMode = 'add' | 'edit';

interface EditorState {
  open: boolean;
  mode: EditorMode;
  originalName?: string;
  transport: McpTransport;
  name: string;
  command: string;
  argsText: string;
  cwd: string;
  envText: string;
  url: string;
  headersText: string;
  enabled: boolean;
}

const EMPTY_EDITOR: Omit<EditorState, 'open' | 'mode' | 'transport'> = {
  name: '',
  command: '',
  argsText: '',
  cwd: '',
  envText: '',
  url: '',
  headersText: '',
  enabled: true,
};

function parseLinePairs(text: string): Record<string, string> | undefined {
  const entries: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.includes('=') ? '=' : line.includes(':') ? ':' : '';
    if (!separator) continue;
    const index = line.indexOf(separator);
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key) entries[key] = value;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}

function stringifyLinePairs(record?: Record<string, string>): string {
  if (!record) return '';
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function parseArgs(text: string): string[] | undefined {
  const args = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return args.length > 0 ? args : undefined;
}

function serverSummary(server: McpServer): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args || [])].filter(Boolean).join(' ');
  }
  return server.url || '';
}

function transportIcon(transport: McpTransport, className = 'h-4 w-4') {
  if (transport === 'stdio') return <Terminal className={className} strokeWidth={2} />;
  if (transport === 'sse') return <Radio className={className} strokeWidth={2} />;
  return <Globe className={className} strokeWidth={2} />;
}

function createEditorState(
  mode: EditorMode,
  transport: McpTransport,
  server?: McpServer,
): EditorState {
  if (server) {
    return {
      open: true,
      mode,
      originalName: server.name,
      transport: server.transport,
      name: server.name,
      command: server.command || '',
      argsText: (server.args || []).join('\n'),
      cwd: server.cwd || '',
      envText: stringifyLinePairs(server.env),
      url: server.url || '',
      headersText: stringifyLinePairs(server.headers),
      enabled: server.enabled,
    };
  }
  return {
    open: true,
    mode,
    transport,
    ...EMPTY_EDITOR,
  };
}

function McpEditorSheet({
  editor,
  saving,
  onClose,
  onChange,
  onSave,
}: {
  editor: EditorState;
  saving: boolean;
  onClose: () => void;
  onChange: (patch: Partial<EditorState>) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('mcp');
  const isRemote = editor.transport !== 'stdio';

  const handleBrowseCwd = async () => {
    const result = await hostApi.dialog.open({
      title: t('form.cwd'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      onChange({ cwd: result.filePaths[0] });
    }
  };

  return (
    <Sheet open={editor.open} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-[520px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-surface-modal shadow-[0_0_40px_rgba(0,0,0,0.2)]"
        side="right"
      >
        <div className="px-7 py-6 border-b border-black/10 dark:border-white/10">
          <h2 className="text-2xl font-serif text-foreground font-normal tracking-tight">
            {editor.mode === 'add' ? t('form.addTitle') : t('form.editTitle')}
          </h2>
          <p className="mt-1 text-meta text-foreground/70">
            {editor.mode === 'add' ? t('form.addSubtitle') : t('form.editSubtitle')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-5">
          <div className="space-y-2">
            <Label>{t('form.typeLabel')}</Label>
            <div className="grid grid-cols-1 gap-2">
              {([
                { id: 'stdio', title: t('transport.stdioTitle'), description: t('transport.stdioDescription') },
                { id: 'sse', title: t('transport.sseTitle'), description: t('transport.sseDescription') },
                { id: 'streamable-http', title: t('transport.httpTitle'), description: t('transport.httpDescription') },
              ] as const).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange({ transport: item.id })}
                  className={cn(
                    'text-left rounded-xl border px-3 py-3 transition-colors',
                    editor.transport === item.id
                      ? 'border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/10'
                      : 'border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {transportIcon(item.id)}
                    <span className="text-sm font-semibold">{item.title}</span>
                    <Badge
                      variant="secondary"
                      className="ml-auto shrink-0 px-1.5 py-0 h-5 text-2xs font-medium bg-black/5 dark:bg-white/10 border-0 shadow-none"
                    >
                      {t(`transport.${item.id}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-name">{t('form.name')}</Label>
            <Input
              id="mcp-name"
              value={editor.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder={t('form.namePlaceholder')}
            />
          </div>

          {isRemote ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-url">{t('form.url')}</Label>
                <Input
                  id="mcp-url"
                  value={editor.url}
                  onChange={(event) => onChange({ url: event.target.value })}
                  placeholder={t('form.urlPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-headers">{t('form.headers')}</Label>
                <Textarea
                  id="mcp-headers"
                  value={editor.headersText}
                  onChange={(event) => onChange({ headersText: event.target.value })}
                  placeholder={t('form.headersPlaceholder')}
                  rows={4}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-command">{t('form.command')}</Label>
                <Input
                  id="mcp-command"
                  value={editor.command}
                  onChange={(event) => onChange({ command: event.target.value })}
                  placeholder={t('form.commandPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-args">{t('form.args')}</Label>
                <Textarea
                  id="mcp-args"
                  value={editor.argsText}
                  onChange={(event) => onChange({ argsText: event.target.value })}
                  placeholder={t('form.argsPlaceholder')}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-cwd">{t('form.cwd')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="mcp-cwd"
                    value={editor.cwd}
                    onChange={(event) => onChange({ cwd: event.target.value })}
                    placeholder={t('form.cwdPlaceholder')}
                  />
                  <Button type="button" variant="outline" onClick={() => void handleBrowseCwd()}>
                    <FolderOpen className="h-4 w-4 mr-1" />
                    {t('form.browse')}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-env">{t('form.env')}</Label>
                <Textarea
                  id="mcp-env"
                  value={editor.envText}
                  onChange={(event) => onChange({ envText: event.target.value })}
                  placeholder={t('form.envPlaceholder')}
                  rows={4}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 px-3 py-3">
            <Label htmlFor="mcp-enabled">{t('form.enabled')}</Label>
            <Switch
              id="mcp-enabled"
              checked={editor.enabled}
              onCheckedChange={(checked) => onChange({ enabled: checked })}
            />
          </div>
        </div>

        <div className="px-7 py-5 border-t border-black/10 dark:border-white/10 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('form.cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function McpDetailSheet({
  server,
  onClose,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: McpServer | null;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('mcp');
  if (!server) return null;

  const rows = server.transport === 'stdio'
    ? [
        { label: t('detail.command'), value: server.command },
        { label: t('detail.args'), value: server.args?.join(' ') },
        { label: t('detail.cwd'), value: server.cwd },
        { label: t('detail.env'), value: stringifyLinePairs(server.env) },
      ]
    : [
        { label: t('detail.url'), value: server.url },
        { label: t('detail.headers'), value: stringifyLinePairs(server.headers) },
      ];

  return (
    <Sheet open={!!server} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-surface-modal shadow-[0_0_40px_rgba(0,0,0,0.2)]"
        side="right"
      >
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-surface-modal border border-black/5 dark:border-white/5 shrink-0 mb-4 shadow-sm">
              {transportIcon(server.transport, 'h-7 w-7')}
            </div>
            <h2 className="text-3xl font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {server.name}
            </h2>
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                {t(`transport.${server.transport}`)}
              </Badge>
              <Badge
                variant="secondary"
                className="font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
              >
                {server.enabled ? t('detail.enabled') : t('detail.disabled')}
              </Badge>
            </div>
          </div>

          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.label}>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{row.label}</div>
                <p className="text-sm text-foreground break-all whitespace-pre-wrap">
                  {row.value || t('detail.none')}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="px-8 py-5 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={server.enabled} onCheckedChange={onToggle} />
            <span className="text-sm text-foreground/70">
              {server.enabled ? t('detail.enabled') : t('detail.disabled')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              {t('detail.edit')}
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('detail.delete')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Mcp() {
  const { t } = useTranslation('mcp');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const { servers, loading, error, fetchServers, addServer, updateServer, toggleServer, removeServer } = useMcpStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);
  const [showGatewayBanner, setShowGatewayBanner] = useState(false);

  const gatewayStopped = isGatewayStopped(gatewayStatus);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowGatewayBanner(gatewayStopped);
    }, gatewayStopped ? 1500 : 0);
    return () => clearTimeout(timer);
  }, [gatewayStopped]);

  useEffect(() => {
    if (!selectedServer) return;
    const next = servers.find((server) => server.name === selectedServer.name);
    setSelectedServer(next || null);
  }, [servers, selectedServer]);

  const enabledCount = servers.filter((server) => server.enabled).length;
  const disabledCount = servers.length - enabledCount;

  const filteredServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return servers.filter((server) => {
      if (statusFilter === 'enabled' && !server.enabled) return false;
      if (statusFilter === 'disabled' && server.enabled) return false;
      if (!query) return true;
      const haystack = [server.name, server.transport, serverSummary(server)].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [servers, searchQuery, statusFilter]);

  const openAdd = useCallback((transport: McpTransport = 'stdio') => {
    setSelectedServer(null);
    setEditor(createEditorState('add', transport));
  }, []);

  const openEdit = useCallback((server: McpServer) => {
    setSelectedServer(null);
    setEditor(createEditorState('edit', server.transport, server));
  }, []);

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    try {
      await toggleServer(name, enabled);
      toast.success(enabled ? t('toast.toggledOn', { name }) : t('toast.toggledOff', { name }));
    } catch (err) {
      toast.error(`${t('toast.failedToggle')}: ${String(err)}`);
    }
  }, [t, toggleServer]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    const input: McpServerInput = {
      name: editor.name,
      transport: editor.transport,
      enabled: editor.enabled,
      command: editor.command,
      args: parseArgs(editor.argsText),
      cwd: editor.cwd,
      env: parseLinePairs(editor.envText),
      url: editor.url,
      headers: parseLinePairs(editor.headersText),
    };
    setSaving(true);
    try {
      if (editor.mode === 'add') {
        await addServer(input);
        toast.success(t('toast.added'));
      } else {
        await updateServer(input, editor.originalName);
        toast.success(t('toast.updated'));
      }
      setEditor(null);
    } catch (err) {
      toast.error(`${editor.mode === 'add' ? t('toast.failedAdd') : t('toast.failedUpdate')}: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [addServer, editor, t, updateServer]);

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      await removeServer(pendingDelete.name);
      toast.success(t('toast.removed'));
      setSelectedServer(null);
    } catch (err) {
      toast.error(`${t('toast.failedRemove')}: ${String(err)}`);
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, removeServer, t]);

  const handleStatusFilterClick = (next: StatusFilter) => {
    setStatusFilter((current) => (current === next ? 'all' : next));
  };

  if (loading) {
    return (
      <div className="flex flex-col -m-6 dark:bg-background min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="mcp-page"
      className="flex flex-col -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden"
    >
      <div className="w-full max-w-5xl mx-auto flex flex-col h-full p-10 pt-16 pb-0">
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-5xl md:text-6xl font-serif text-foreground mb-3 font-normal tracking-tight">
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
          <Button
            type="button"
            onClick={() => openAdd('stdio')}
            className="md:mt-2 h-8 rounded-full px-4"
          >
            <Plus className="h-4 w-4 mr-1" />
            {t('actions.add')}
          </Button>
        </div>

        {showGatewayBanner && (
          <div
            data-testid="mcp-gateway-banner"
            className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3"
          >
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">{t('gatewayWarning')}</span>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-4 shrink-0 gap-4">
          <div className="flex items-center flex-wrap gap-2 text-sm">
            <div className="relative group flex items-center bg-black/5 dark:bg-white/5 rounded-full px-3 py-1.5 focus-within:bg-black/10 transition-colors border border-transparent focus-within:border-black/10 dark:focus-within:border-white/10 mr-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-meta text-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleStatusFilterClick('enabled')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                statusFilter === 'enabled'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('filter.enabledList', { count: enabledCount })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleStatusFilterClick('disabled')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                statusFilter === 'disabled'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('filter.disabledList', { count: disabledCount })}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {filteredServers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Cable className="h-10 w-10 mb-4 opacity-50" />
              <p className="mb-6">{searchQuery ? t('empty.search') : t('empty.title')}</p>
              {!searchQuery && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-3xl">
                  {([
                    { id: 'stdio' as const, title: t('transport.stdioTitle'), description: t('transport.stdioDescription') },
                    { id: 'sse' as const, title: t('transport.sseTitle'), description: t('transport.sseDescription') },
                    { id: 'streamable-http' as const, title: t('transport.httpTitle'), description: t('transport.httpDescription') },
                  ]).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openAdd(item.id)}
                      className="text-left rounded-2xl border border-black/10 dark:border-white/10 px-4 py-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-2 text-foreground">
                        {transportIcon(item.id)}
                        <span className="text-sm font-semibold">{item.title}</span>
                      </div>
                      <p className="text-xs leading-relaxed">{item.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredServers.map((server) => (
                <div
                  key={server.name}
                  className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                  onClick={() => setSelectedServer(server)}
                >
                  <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                    <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl text-foreground/80">
                      {transportIcon(server.transport, 'h-5 w-5')}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-foreground truncate">{server.name}</h3>
                        <Badge
                          variant="secondary"
                          className="shrink-0 whitespace-nowrap px-1.5 py-0 h-5 text-2xs font-medium bg-black/5 dark:bg-white/10 border-0 shadow-none"
                        >
                          {t(`transport.${server.transport}`)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1 pr-6 leading-relaxed font-mono">
                        {serverSummary(server) || t('detail.none')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0" onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(checked) => void handleToggle(server.name, checked)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editor && (
        <McpEditorSheet
          editor={editor}
          saving={saving}
          onClose={() => setEditor(null)}
          onChange={(patch) => setEditor((current) => (current ? { ...current, ...patch } : current))}
          onSave={() => void handleSave()}
        />
      )}

      <McpDetailSheet
        server={selectedServer}
        onClose={() => setSelectedServer(null)}
        onToggle={(enabled) => {
          if (!selectedServer) return;
          void handleToggle(selectedServer.name, enabled);
        }}
        onEdit={() => {
          if (selectedServer) openEdit(selectedServer);
        }}
        onDelete={() => {
          if (selectedServer) setPendingDelete(selectedServer);
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('confirmDelete.title')}
        message={t('confirmDelete.message', { name: pendingDelete?.name || '' })}
        confirmLabel={t('confirmDelete.confirm')}
        cancelLabel={t('confirmDelete.cancel')}
        variant="destructive"
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default Mcp;
