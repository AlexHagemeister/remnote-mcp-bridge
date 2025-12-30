/**
 * RemNote MCP Server
 * 
 * bridges mcp protocol (sse/streamable http) <-> websocket (remnote plugin)
 * 
 * architecture:
 * - claude mobile connects via sse at /sse or /mcp
 * - remnote plugin connects via websocket at ws://host:port
 * - server routes mcp tool calls to connected plugin, returns responses
 */

import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// types
// ============================================================================

interface BridgeRequest {
  id: string;
  action: string;
  payload: Record<string, unknown>;
}

interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3002', 10);
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// ============================================================================
// websocket connection manager (plugin side)
// ============================================================================

class PluginConnectionManager {
  private connections: Map<string, WebSocket> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private activeConnectionId: string | null = null;

  /**
   * register new websocket connection from remnote plugin
   */
  addConnection(ws: WebSocket): string {
    const connectionId = uuidv4();
    this.connections.set(connectionId, ws);
    
    // set as active if first connection
    if (!this.activeConnectionId) {
      this.activeConnectionId = connectionId;
    }
    
    console.log(`[plugin] connected: ${connectionId} (total: ${this.connections.size})`);
    
    // handle incoming messages (responses from plugin)
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as BridgeResponse;
        this.handleResponse(message);
      } catch (err) {
        console.error('[plugin] failed to parse message:', err);
      }
    });
    
    // cleanup on close
    ws.on('close', () => {
      this.connections.delete(connectionId);
      if (this.activeConnectionId === connectionId) {
        // switch to another connection if available
        const remaining = Array.from(this.connections.keys());
        this.activeConnectionId = remaining.length > 0 ? remaining[0] : null;
      }
      console.log(`[plugin] disconnected: ${connectionId} (remaining: ${this.connections.size})`);
    });
    
    // send initial endpoint event (legacy sse protocol compat)
    ws.send(JSON.stringify({ type: 'connected', connectionId }));
    
    return connectionId;
  }
  
  /**
   * check if any plugin is connected
   */
  hasActiveConnection(): boolean {
    return this.activeConnectionId !== null && 
           this.connections.has(this.activeConnectionId);
  }
  
  /**
   * send request to plugin and wait for response
   */
  async sendRequest(action: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.hasActiveConnection()) {
      throw new Error('No RemNote plugin connected. Open RemNote and ensure the MCP Bridge plugin is active.');
    }
    
    const requestId = uuidv4();
    const request: BridgeRequest = { id: requestId, action, payload };
    
    return new Promise((resolve, reject) => {
      // timeout handler
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      
      // store pending request
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      
      // send to plugin
      const ws = this.connections.get(this.activeConnectionId!);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(request));
        console.log(`[plugin] sent: ${action} (${requestId})`);
      } else {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(new Error('WebSocket connection not ready'));
      }
    });
  }
  
  /**
   * handle response from plugin
   */
  private handleResponse(response: BridgeResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn(`[plugin] received response for unknown request: ${response.id}`);
      return;
    }
    
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    
    if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
    
    console.log(`[plugin] received response: ${response.id}`);
  }
  
  /**
   * broadcast heartbeat ping to all connections
   */
  pingAll(): void {
    for (const [id, ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }
  }
}

// ============================================================================
// mcp server setup
// ============================================================================

function createMcpServer(pluginManager: PluginConnectionManager): McpServer {
  const server = new McpServer(
    {
      name: 'remnote-mcp-server',
      version: '1.0.0'
    },
    { capabilities: { logging: {} } }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_create_note
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_create_note',
    'Create a new note in RemNote',
    {
      title: z.string().describe('Title of the note'),
      content: z.string().optional().describe('Content of the note (each line becomes a child)'),
      parentId: z.string().optional().describe('ID of parent Rem (optional)'),
      tags: z.array(z.string()).optional().describe('Tags to add to the note')
    },
    async ({ title, content, parentId, tags }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('create_note', {
          title, content, parentId, tags
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true
        };
      }
    }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_search
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_search',
    'Search the RemNote knowledge base',
    {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 20)'),
      includeContent: z.boolean().optional().describe('Include note content in results')
    },
    async ({ query, limit, includeContent }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('search', {
          query, limit, includeContent
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true
        };
      }
    }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_read_note
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_read_note',
    'Read a note and its children by ID',
    {
      remId: z.string().describe('ID of the Rem to read'),
      depth: z.number().optional().describe('How deep to fetch children (default 3)')
    },
    async ({ remId, depth }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('read_note', {
          remId, depth
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true
        };
      }
    }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_update_note
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_update_note',
    'Update an existing note',
    {
      remId: z.string().describe('ID of the Rem to update'),
      title: z.string().optional().describe('New title'),
      appendContent: z.string().optional().describe('Content to append'),
      addTags: z.array(z.string()).optional().describe('Tags to add'),
      removeTags: z.array(z.string()).optional().describe('Tags to remove')
    },
    async ({ remId, title, appendContent, addTags, removeTags }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('update_note', {
          remId, title, appendContent, addTags, removeTags
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true
        };
      }
    }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_append_journal
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_append_journal',
    "Add an entry to today's daily document",
    {
      content: z.string().describe('Content to add to journal'),
      timestamp: z.boolean().optional().describe('Include timestamp (default from settings)')
    },
    async ({ content, timestamp }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('append_journal', {
          content, timestamp
        });
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`
          }],
          isError: true
        };
      }
    }
  );
  
  // -------------------------------------------------------------------------
  // tool: remnote_status
  // -------------------------------------------------------------------------
  server.tool(
    'remnote_status',
    'Check connection status to RemNote',
    {},
    async (): Promise<CallToolResult> => {
      const connected = pluginManager.hasActiveConnection();
      
      if (connected) {
        try {
          const result = await pluginManager.sendRequest('get_status', {});
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ connected: true, ...result as object }, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                connected: false,
                error: err instanceof Error ? err.message : String(err)
              }, null, 2)
            }]
          };
        }
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            connected: false,
            message: 'No RemNote plugin connected. Open RemNote and ensure MCP Bridge plugin is active.'
          }, null, 2)
        }]
      };
    }
  );
  
  return server;
}

// ============================================================================
// express app + sse transport
// ============================================================================

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());
  
  // create http server for both express and websocket
  const httpServer = createServer(app);
  
  // plugin connection manager
  const pluginManager = new PluginConnectionManager();
  
  // websocket server for remnote plugin connections
  const wss = new WebSocketServer({ server: httpServer });
  
  wss.on('connection', (ws) => {
    pluginManager.addConnection(ws);
  });
  
  // heartbeat interval to keep connections alive
  setInterval(() => {
    pluginManager.pingAll();
  }, 30000);
  
  // store active sse transports
  const transports: Map<string, SSEServerTransport> = new Map();
  
  // -------------------------------------------------------------------------
  // sse endpoint (legacy http+sse protocol)
  // -------------------------------------------------------------------------
  app.get('/sse', async (req: Request, res: Response) => {
    console.log('[sse] new connection');
    
    try {
      // create sse transport - messages endpoint for client posts
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);
      
      transport.onclose = () => {
        console.log(`[sse] closed: ${sessionId}`);
        transports.delete(sessionId);
      };
      
      // create mcp server for this session
      const mcpServer = createMcpServer(pluginManager);
      await mcpServer.connect(transport);
      
      console.log(`[sse] established: ${sessionId}`);
    } catch (err) {
      console.error('[sse] error:', err);
      if (!res.headersSent) {
        res.status(500).send('SSE connection failed');
      }
    }
  });
  
  // -------------------------------------------------------------------------
  // messages endpoint (for sse clients to post requests)
  // -------------------------------------------------------------------------
  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    
    if (!sessionId) {
      res.status(400).send('Missing sessionId');
      return;
    }
    
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }
    
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error('[messages] error:', err);
      if (!res.headersSent) {
        res.status(500).send('Request failed');
      }
    }
  });
  
  // -------------------------------------------------------------------------
  // health check endpoint
  // -------------------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      pluginConnected: pluginManager.hasActiveConnection(),
      activeSessions: transports.size
    });
  });
  
  // -------------------------------------------------------------------------
  // root endpoint - info
  // -------------------------------------------------------------------------
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'remnote-mcp-server',
      version: '1.0.0',
      description: 'MCP server for RemNote integration',
      endpoints: {
        sse: '/sse - SSE endpoint for MCP clients',
        messages: '/messages - POST endpoint for SSE client requests',
        health: '/health - Server health check'
      },
      pluginConnected: pluginManager.hasActiveConnection()
    });
  });
  
  // -------------------------------------------------------------------------
  // start server
  // -------------------------------------------------------------------------
  httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    RemNote MCP Server                          ║
╠════════════════════════════════════════════════════════════════╣
║  HTTP/SSE:  http://localhost:${PORT}/sse                         ║
║  WebSocket: ws://localhost:${PORT}                               ║
║  Health:    http://localhost:${PORT}/health                      ║
╚════════════════════════════════════════════════════════════════╝

Waiting for connections...
- RemNote plugin connects via WebSocket
- Claude/MCP clients connect via SSE at /sse
`);
  });
  
  // graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    
    // close all sse transports
    for (const [sessionId, transport] of transports) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`Error closing transport ${sessionId}:`, err);
      }
    }
    
    // close websocket server
    wss.close();
    
    // close http server
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch(console.error);

