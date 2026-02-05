# RemNote MCP Server

MCP server that bridges Claude (via SSE) with RemNote (via the MCP Bridge plugin).

## ⚠️ Security Notice

**Each user must deploy their own server instance.** Do not share your server URL with others, as this could expose your RemNote data. The server has no authentication and routes requests to connected RemNote instances.

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

## Deployment Options

### Option 1: Railway (Recommended)

**Prerequisites:**
- Railway account (free tier available)
- Railway CLI installed: `npm install -g @railway/cli`

**Steps:**

1. **Fork the repository** to your GitHub account first
2. **Deploy from server directory:**
   ```bash
   cd server
   railway login
   railway init
   railway up
   ```
3. **Get your URL:** Railway provides `https://your-app-name.up.railway.app`
4. **Keep your URL private** - treat it like a password

### Option 2: Render

1. Create account at [render.com](https://render.com)
2. Create new Web Service
3. Connect your forked GitHub repo
4. Set root directory to `server`
5. Build command: `npm install && npm run build`
6. Start command: `npm start`

### Option 3: Fly.io

```bash
cd server
fly launch
fly deploy
```

### Option 4: Docker (Self-hosted)

```bash
cd server
docker build -t remnote-mcp-server .
docker run -p 3002:3002 remnote-mcp-server
```

### Option 5: Local Development

```bash
cd server
npm install
npm run dev
```

Server runs at `http://localhost:3002`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3002 | Railway sets this automatically |

**Note:** No `REMNOTE_API_KEY` needed - RemNote access is via the browser plugin.

## Claude Configuration

### Claude Desktop/Web

Go to **Settings → Connectors → Add custom connector**

Enter **your** server URL (not someone else's!):
- Deployed: `https://your-app-name.up.railway.app/sse`
- Local: `http://localhost:3002/sse`

### Claude Mobile

Add custom connector with **your** deployed URL:
```
https://your-app-name.up.railway.app/sse
```

**Important:** Replace `your-app-name` with your actual deployment URL. Never use someone else's server URL.

## RemNote Plugin Configuration

In RemNote, go to **Settings → Plugins → MCP Bridge** and set:

**WebSocket server URL** to **your** server:
- Deployed: `wss://your-app-name.up.railway.app`
- Local: `ws://127.0.0.1:3002`

**Security:** Use only your own server URL. Never connect to someone else's server as it could expose your RemNote data.

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

