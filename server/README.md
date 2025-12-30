# RemNote MCP Server

MCP server that bridges Claude (via SSE) with RemNote (via the MCP Bridge plugin).

## Architecture

```
┌─────────────────┐     SSE/HTTP       ┌─────────────────┐
│   Claude App    │◄──────────────────►│   MCP Server    │
│ (Mobile/Desktop)│     :PORT/sse      │  (This server)  │
└─────────────────┘                    └────────┬────────┘
                                               │
                                          WebSocket
                                           :PORT
                                               │
                                       ┌───────▼────────┐
                                       │ RemNote Plugin │
                                       │  (In browser)  │
                                       └───────┬────────┘
                                               │
                                          Plugin SDK
                                               │
                                       ┌───────▼────────┐
                                       │    RemNote     │
                                       │ Knowledge Base │
                                       └────────────────┘
```

## Deployment to Railway

### 1. Create Railway Project

```bash
# from server directory
cd server

# login to railway
railway login

# init project
railway init

# link to project (if already created in dashboard)
railway link
```

### 2. Deploy

```bash
railway up
```

### 3. Get Your URL

After deployment, Railway provides a URL like:
```
https://your-app-name.up.railway.app
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3002 | Railway sets this automatically |

**Note:** No `REMNOTE_API_KEY` needed - RemNote access is via the browser plugin.

## Claude MCP Configuration

### Claude Desktop (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "remnote": {
      "url": "https://your-app-name.up.railway.app/sse"
    }
  }
}
```

### Claude Mobile App

Add MCP server with URL:
```
https://your-app-name.up.railway.app/sse
```

## RemNote Plugin Configuration

In RemNote, go to **Settings > Plugins > MCP Bridge** and set:

- **WebSocket server URL**: `wss://your-app-name.up.railway.app`

For local development:
- **WebSocket server URL**: `ws://127.0.0.1:3002`

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `remnote_create_note` | Create a new note with title, content, parent, and tags |
| `remnote_search` | Search the knowledge base |
| `remnote_read_note` | Read a note's content and children by ID |
| `remnote_update_note` | Update title, append content, add/remove tags |
| `remnote_append_journal` | Add entry to today's daily document |
| `remnote_status` | Check connection status |

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | SSE stream for MCP clients |
| `/messages` | POST | Message endpoint for SSE protocol |
| `/health` | GET | Health check (used by Railway) |
| `/` | GET | Server info |

## Local Development

```bash
# install dependencies
npm install

# run in dev mode (with hot reload)
npm run dev

# build
npm run build

# run production build
npm start
```

## Testing the Connection

1. Start the server locally: `npm run dev`
2. Open RemNote with the MCP Bridge plugin installed
3. Plugin should show "Connected" status
4. Test with curl:

```bash
# check health
curl http://localhost:3002/health

# should show: {"status":"ok","pluginConnected":true,"activeSessions":0}
```

## Troubleshooting

### Plugin shows "Disconnected"

1. Verify server is running
2. Check WebSocket URL in plugin settings
3. If deployed, ensure plugin uses `wss://` (not `ws://`)

### Claude can't connect

1. Verify Railway deployment is active
2. Check the SSE URL format: `https://your-app.up.railway.app/sse`
3. Test `/health` endpoint to verify server is responding

### Tools return errors

1. Ensure RemNote is open with plugin active
2. Check server logs for connection status
3. Verify plugin shows "Connected" in sidebar widget

