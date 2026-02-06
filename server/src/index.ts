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
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// stdio mode detection
// ============================================================================

const isStdioMode = process.argv.includes('--stdio');

// in stdio mode, stdout is reserved for json-rpc protocol messages.
// redirect all console output to stderr so it doesnt corrupt the transport.
if (isStdioMode) {

  const stderrWrite = (args: unknown[]) => {
    process.stderr.write(args.map(String).join(' ') + '\n');
  };

  console.log = (...args: unknown[]) => stderrWrite(args);
  console.error = (...args: unknown[]) => stderrWrite(args);
  console.warn = (...args: unknown[]) => stderrWrite(args);
  console.info = (...args: unknown[]) => stderrWrite(args);
}

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

/**
 * common interface for sending requests to the remnote plugin.
 * implemented by both the real ws manager and the http proxy.
 */
interface RequestSender {
  sendRequest(action: string, payload: Record<string, unknown>): Promise<unknown>;
  hasActiveConnection(): boolean;
}

// ============================================================================
// configuration
// ============================================================================

const PORT = parseInt(process.env.PORT || '3002', 10);
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// ============================================================================
// websocket connection manager (plugin side)
// ============================================================================

class PluginConnectionManager implements RequestSender {
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
// proxy request sender (for stdio instances that forward to existing server)
// ============================================================================

/**
 * forwards tool requests via http to an already-running server instance.
 * used when a second --stdio process detects an existing server on the port.
 */
class ProxyRequestSender implements RequestSender {

  private baseUrl: string;

  constructor(baseUrl: string) {

    this.baseUrl = baseUrl;
  }

  /**
   * optimistic — actual plugin check happens on the real server.
   * if plugin is disconnected, sendRequest will throw with a clear message.
   */
  hasActiveConnection(): boolean {

    return true;
  }

  /**
   * forward request to the real server's /api/request endpoint.
   */
  async sendRequest(action: string, payload: Record<string, unknown>): Promise<unknown> {

    const res = await fetch(`${this.baseUrl}/api/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
    });

    if (!res.ok) {

      throw new Error(`Proxy request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { result?: unknown; error?: string };

    if (data.error) {
      throw new Error(data.error);
    }

    return data.result;
  }
}

// ============================================================================
// existing server discovery
// ============================================================================

/**
 * scan ports for a running remnote mcp server instance.
 * checks startPort through startPort + maxAttempts - 1.
 * returns the base url of the first healthy server found, or null.
 */
async function findExistingServer(
  startPort: number,
  maxAttempts: number = 5
): Promise<string | null> {

  for (let i = 0; i < maxAttempts; i++) {

    const port = startPort + i;

    try {

      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });

      const data = await res.json() as { status: string };

      if (data.status === 'ok') {

        return `http://localhost:${port}`;
      }
    } catch {

      // port not responding, try next
    }
  }

  return null;
}

// ============================================================================
// mcp server setup
// ============================================================================

function createMcpServer(pluginManager: RequestSender): McpServer {
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
      tags: z.array(z.string()).optional().describe('Tags to add to the note'),
      markAs: z.enum(['document', 'folder']).optional().describe(
        'Mark the Rem as a document or folder. Documents appear in the sidebar with a doc icon and act as zoom points. Folders are documents that organize other documents.'
      )
    },
    async ({ title, content, parentId, tags, markAs }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('create_note', {
          title, content, parentId, tags, markAs
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
      removeTags: z.array(z.string()).optional().describe('Tags to remove'),
      markAs: z.enum(['document', 'folder']).optional().describe(
        'Mark the Rem as a document or folder. Documents appear in the sidebar with a doc icon and act as zoom points. Folders are documents that organize other documents.'
      )
    },
    async ({ remId, title, appendContent, addTags, removeTags, markAs }): Promise<CallToolResult> => {
      try {
        const result = await pluginManager.sendRequest('update_note', {
          remId, title, appendContent, addTags, removeTags, markAs
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

/**
 * start http + websocket server for plugin connections.
 * handles EADDRINUSE by retrying on next port.
 */
function startHttpServer(
  httpServer: ReturnType<typeof createServer>,
  port: number
): Promise<number> {

  return new Promise((resolve, reject) => {

    const onError = (err: NodeJS.ErrnoException) => {

      if (err.code === 'EADDRINUSE') {

        // port busy - try next port
        console.warn(`[server] port ${port} in use, trying ${port + 1}`);
        httpServer.removeListener('error', onError);
        startHttpServer(httpServer, port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    };

    httpServer.on('error', onError);

    httpServer.listen(port, () => {
      httpServer.removeListener('error', onError);
      resolve(port);
    });
  });
}

async function main(): Promise<void> {

  // =========================================================================
  // stdio proxy mode: if an existing server is running, just proxy to it.
  // this lets multiple mcp clients (cursor + claude desktop) share the
  // single websocket connection to the remnote plugin.
  // =========================================================================

  if (isStdioMode) {

    const existingServerUrl = await findExistingServer(PORT);

    if (existingServerUrl) {

      console.log(`[stdio] existing server found at ${existingServerUrl}, running in proxy mode`);

      const proxyManager = new ProxyRequestSender(existingServerUrl);
      const mcpServer = createMcpServer(proxyManager);
      const transport = new StdioServerTransport();
      await mcpServer.connect(transport);

      console.log(`[stdio] proxy mode active — all tool calls forwarded to ${existingServerUrl}`);

      // no http/ws server needed, just keep stdio alive
      return;
    }

    // no existing server found, fall through to start full server
    console.log(`[stdio] no existing server found, starting full server`);
  }

  // =========================================================================
  // full server mode: start http/ws + optional stdio transport
  // =========================================================================

  const app = express();
  app.use(express.json());

  // create http server for both express and websocket
  const httpServer = createServer(app);

  // plugin connection manager
  const pluginManager = new PluginConnectionManager();

  // -------------------------------------------------------------------------
  // health check endpoint (available in both modes)
  // -------------------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      pluginConnected: pluginManager.hasActiveConnection(),
      mode: isStdioMode ? 'stdio' : 'sse'
    });
  });

  // -------------------------------------------------------------------------
  // internal api: proxy stdio instances forward tool requests here
  // -------------------------------------------------------------------------
  app.post('/api/request', async (req: Request, res: Response) => {

    const { action, payload } = req.body as {
      action: string;
      payload: Record<string, unknown>;
    };

    try {

      const result = await pluginManager.sendRequest(action, payload);
      res.json({ result });
    } catch (err) {

      res.json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // start http server first, THEN attach websocket.
  // creating WSS before listen causes unhandled error on EADDRINUSE
  // because the error propagates to both httpServer AND the WSS.
  const actualPort = await startHttpServer(httpServer, PORT);

  // websocket server for remnote plugin connections (safe now, port is bound)
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    pluginManager.addConnection(ws);
  });

  // heartbeat interval to keep connections alive
  setInterval(() => {
    pluginManager.pingAll();
  }, 30000);

  // =========================================================================
  // sse endpoints (available in ALL modes so multiple clients can connect)
  // cursor uses stdio, claude desktop / mobile use sse — same server instance
  // =========================================================================

  // store active sse transports
  const sseTransports: Map<string, SSEServerTransport> = new Map();

  app.get('/sse', async (req: Request, res: Response) => {
    console.log('[sse] new connection');

    try {

      // create sse transport - messages endpoint for client posts
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      sseTransports.set(sessionId, transport);

      transport.onclose = () => {
        console.log(`[sse] closed: ${sessionId}`);
        sseTransports.delete(sessionId);
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

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;

    if (!sessionId) {
      res.status(400).send('Missing sessionId');
      return;
    }

    const transport = sseTransports.get(sessionId);
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

  // =========================================================================
  // stdio transport (only in --stdio mode, used by cursor)
  // =========================================================================

  if (isStdioMode) {

    const mcpServer = createMcpServer(pluginManager);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    console.log(`[stdio] mcp transport: stdio`);
    console.log(`[stdio] sse also available: http://localhost:${actualPort}/sse`);
    console.log(`[stdio] websocket for plugin: ws://localhost:${actualPort}`);

  } else {

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    RemNote MCP Server                          ║
╠════════════════════════════════════════════════════════════════╣
║  HTTP/SSE:  http://localhost:${actualPort}/sse                         ║
║  WebSocket: ws://localhost:${actualPort}                               ║
║  Health:    http://localhost:${actualPort}/health                      ║
╚════════════════════════════════════════════════════════════════╝

Waiting for connections...
- RemNote plugin connects via WebSocket
- Claude/MCP clients connect via SSE at /sse
`);
  }

  // graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    wss.close();
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch(console.error);

