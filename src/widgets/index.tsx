/**
 * RemNote MCP Bridge Plugin
 *
 * entry point for the remnote plugin that connects to the mcp server.
 * websocket connection is established here in onActivate, not in the widget.
 * this ensures connection runs even without opening the sidebar.
 */

import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import {
  SETTING_AUTO_TAG_ENABLED,
  SETTING_AUTO_TAG,
  SETTING_JOURNAL_PREFIX,
  SETTING_JOURNAL_TIMESTAMP,
  SETTING_WS_URL,
  SETTING_DEFAULT_PARENT,
  DEFAULT_AUTO_TAG,
  DEFAULT_JOURNAL_PREFIX,
  DEFAULT_WS_URL,
  MCPSettings,
} from '../settings';
import { WebSocketClient, BridgeRequest } from '../bridge/websocket-client';
import { RemAdapter } from '../api/rem-adapter';

// global refs for connection manager
let wsClient: WebSocketClient | null = null;
let remAdapter: RemAdapter | null = null;
let currentPlugin: ReactRNPlugin | null = null;

// connection status stored globally for widget access
export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  stats: { created: number; updated: number; journal: number; searches: number };
  logs: Array<{ timestamp: Date; message: string; level: 'info' | 'error' | 'warn' | 'success' }>;
}

export const connectionState: ConnectionState = {
  status: 'disconnected',
  stats: { created: 0, updated: 0, journal: 0, searches: 0 },
  logs: [],
};

// add log helper
function addLog(message: string, level: ConnectionState['logs'][0]['level'] = 'info') {
  
  connectionState.logs.push({ timestamp: new Date(), message, level });
  
  // keep only last 50 logs
  if (connectionState.logs.length > 50) {
    
    connectionState.logs = connectionState.logs.slice(-50);
  }
  console.log(`[MCP Bridge] ${message}`);
}

// handle incoming requests from mcp server
async function handleRequest(request: BridgeRequest): Promise<unknown> {
  
  if (!remAdapter) {
    
    throw new Error('RemAdapter not initialized');
  }

  const payload = request.payload;
  addLog(`Received action: ${request.action}`, 'info');

  switch (request.action) {
    
    case 'create_note': {
      
      const result = await remAdapter.createNote({
        title: payload.title as string,
        content: payload.content as string | undefined,
        parentId: payload.parentId as string | undefined,
        tags: payload.tags as string[] | undefined,
      });
      connectionState.stats.created++;
      
      return result;
    }

    case 'append_journal': {
      
      const result = await remAdapter.appendJournal({
        content: payload.content as string,
        timestamp: payload.timestamp as boolean | undefined,
      });
      connectionState.stats.journal++;
      
      return result;
    }

    case 'search': {
      
      const result = await remAdapter.search({
        query: payload.query as string,
        limit: payload.limit as number | undefined,
        includeContent: payload.includeContent as boolean | undefined,
      });
      connectionState.stats.searches++;
      
      return result;
    }

    case 'read_note': {
      
      const result = await remAdapter.readNote({
        remId: payload.remId as string,
        depth: payload.depth as number | undefined,
      });
      
      return result;
    }

    case 'update_note': {
      
      const result = await remAdapter.updateNote({
        remId: payload.remId as string,
        title: payload.title as string | undefined,
        appendContent: payload.appendContent as string | undefined,
        addTags: payload.addTags as string[] | undefined,
        removeTags: payload.removeTags as string[] | undefined,
      });
      connectionState.stats.updated++;
      
      return result;
    }

    case 'get_status':
      return await remAdapter.getStatus();

    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}

// initialize websocket connection
async function initializeConnection(plugin: ReactRNPlugin) {
  
  // get settings
  const wsUrl = (await plugin.settings.getSetting<string>(SETTING_WS_URL)) || DEFAULT_WS_URL;
  const autoTagEnabled = (await plugin.settings.getSetting<boolean>(SETTING_AUTO_TAG_ENABLED)) ?? true;
  const autoTag = (await plugin.settings.getSetting<string>(SETTING_AUTO_TAG)) || DEFAULT_AUTO_TAG;
  const journalPrefix = (await plugin.settings.getSetting<string>(SETTING_JOURNAL_PREFIX)) || DEFAULT_JOURNAL_PREFIX;
  const journalTimestamp = (await plugin.settings.getSetting<boolean>(SETTING_JOURNAL_TIMESTAMP)) ?? true;
  const defaultParentId = (await plugin.settings.getSetting<string>(SETTING_DEFAULT_PARENT)) || '';

  const settings: MCPSettings = {
    autoTagEnabled,
    autoTag,
    journalPrefix,
    journalTimestamp,
    wsUrl,
    defaultParentId,
  };

  // init rem adapter
  remAdapter = new RemAdapter(plugin as any, settings);
  addLog('RemAdapter initialized', 'success');

  // init websocket client
  wsClient = new WebSocketClient({
    url: wsUrl,
    maxReconnectAttempts: 10,
    initialReconnectDelay: 1000,
    maxReconnectDelay: 30000,
    onStatusChange: (status) => {
      
      connectionState.status = status;
    },
    onLog: (message, level) => {
      
      addLog(message, level);
    },
  });

  wsClient.setMessageHandler(handleRequest);
  
  // connect
  addLog(`Connecting to MCP server at ${wsUrl}...`, 'info');
  wsClient.connect();
}

async function onActivate(plugin: ReactRNPlugin) {
  
  console.log('[MCP Bridge] Plugin activating...');
  currentPlugin = plugin;

  // register settings
  await plugin.settings.registerBooleanSetting({
    id: SETTING_AUTO_TAG_ENABLED,
    title: 'Auto-tag MCP notes',
    description: 'Automatically add a tag to all notes created via MCP',
    defaultValue: true,
  });

  await plugin.settings.registerStringSetting({
    id: SETTING_AUTO_TAG,
    title: 'Auto-tag name',
    description: 'Tag name to add to MCP-created notes (e.g., "MCP", "Claude")',
    defaultValue: DEFAULT_AUTO_TAG,
  });

  await plugin.settings.registerStringSetting({
    id: SETTING_JOURNAL_PREFIX,
    title: 'Journal entry prefix',
    description: 'Prefix for journal entries (e.g., "[Claude]", "[MCP]")',
    defaultValue: DEFAULT_JOURNAL_PREFIX,
  });

  await plugin.settings.registerBooleanSetting({
    id: SETTING_JOURNAL_TIMESTAMP,
    title: 'Add timestamp to journal',
    description: 'Include timestamp in journal entries',
    defaultValue: true,
  });

  await plugin.settings.registerStringSetting({
    id: SETTING_WS_URL,
    title: 'WebSocket server URL',
    description: 'URL of the MCP WebSocket server',
    defaultValue: DEFAULT_WS_URL,
  });

  await plugin.settings.registerStringSetting({
    id: SETTING_DEFAULT_PARENT,
    title: 'Default parent Rem ID',
    description: 'ID of the Rem to use as default parent for new notes (leave empty for root)',
    defaultValue: '',
  });

  console.log('[MCP Bridge] Settings registered');

  // register the sidebar widget (optional ui)
  await plugin.app.registerWidget('right_sidebar', WidgetLocation.RightSidebar, {
    dimensions: {
      width: 300,
      height: '100%',
    },
    widgetTabIcon: 'https://claude.ai/favicon.ico',
  });

  console.log('[MCP Bridge] Widget registered successfully');

  // initialize websocket connection immediately
  await initializeConnection(plugin);
}

async function onDeactivate(_: ReactRNPlugin) {
  
  console.log('[MCP Bridge] Plugin deactivating...');
  
  // disconnect websocket
  if (wsClient) {
    
    wsClient.disconnect();
    wsClient = null;
  }
  
  remAdapter = null;
  currentPlugin = null;
}

declareIndexPlugin(onActivate, onDeactivate);
