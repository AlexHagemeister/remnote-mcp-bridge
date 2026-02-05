# RemNote MCP Bridge

Connect RemNote to AI assistants (Claude, GPT, etc.) via the **Model Context Protocol (MCP)**. This project enables bidirectional communication, allowing AI to read and write directly to your RemNote knowledge base.

![Status](https://img.shields.io/badge/status-beta-yellow)
![License](https://img.shields.io/badge/license-MIT-blue)

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open standard by Anthropic that allows AI assistants to interact with external tools and data sources. With this bridge, your AI assistant becomes a true PKM companion.

## Features

### Core Capabilities
- **Create Notes** - AI can create new notes with titles, content, and tags
- **Search Knowledge Base** - Full-text search across all your Rems
- **Read Notes** - Access note content and hierarchical children
- **Update Notes** - Modify existing notes, append content, manage tags
- **Daily Journal** - Append entries to today's daily document

### Plugin Features
- **Auto-tagging** - Automatically tag notes created via MCP (configurable)
- **Session Statistics** - Track created/updated/journal entries/searches
- **Action History** - View last 10 MCP actions with timestamps
- **Configurable Settings** - Customize behavior through RemNote settings
- **Real-time Status** - Connection status indicator in sidebar widget

## ⚠️ Important: Deploy Your Own Server

**Security Notice:** Each user must deploy their own MCP server instance. Do not share server URLs between users, as this could expose your RemNote data to others.

### Quick Start Options

**Option A: Local Development** (Recommended for testing)
- Server runs on your computer
- No cloud deployment needed
- Works with Claude Desktop only

**Option B: Cloud Deployment** (Required for Claude Mobile)
- Deploy to Railway, Render, or similar
- Enables Claude Mobile access
- Each user needs their own deployment

See [server/README.md](server/README.md) for detailed deployment instructions.

## Installation

### 1. Install the RemNote Plugin

**Option A: Marketplace** (once approved)
- Search for "MCP Bridge" in RemNote's Plugin marketplace

**Option B: Development Mode**
```bash
git clone https://github.com/AlexHagemeister/remnote-mcp-bridge.git
cd remnote-mcp-bridge
npm install
npm run dev
```
Then in RemNote: **Settings → Plugins → Build → Develop from localhost**

### 2. Deploy Your MCP Server

**⚠️ Critical: Each user must deploy their own server instance for security.**

#### Option A: Local Server (Easiest)

```bash
cd server
npm install
npm run dev
```

Server runs at `http://localhost:3002`

#### Option B: Railway Deployment (For Claude Mobile)

1. **Fork this repository** to your GitHub account
2. **Deploy to Railway:**
   ```bash
   cd server
   railway login
   railway init
   railway up
   ```
3. **Note your URL:** `https://your-app-name.up.railway.app`

See [server/README.md](server/README.md) for detailed deployment guides including Render, Fly.io, and Docker.

### 3. Configure RemNote Plugin

In RemNote: **Settings → Plugins → MCP Bridge**

Set **WebSocket server URL** to:
- Local: `ws://127.0.0.1:3002`
- Railway: `wss://your-app-name.up.railway.app`

### 4. Configure Your AI Assistant

#### For Claude Desktop/Web

Go to **Settings → Connectors → Add custom connector**

Enter your server URL:
- Local: `http://localhost:3002/sse`
- Railway: `https://your-app-name.up.railway.app/sse`

#### For Claude Mobile

Add custom connector with your Railway URL:
```
https://your-app-name.up.railway.app/sse
```

**Note:** Claude Mobile requires a cloud-deployed server (Railway, Render, etc.)

## Configuration

Access plugin settings in RemNote via **Settings > Plugins > MCP Bridge**:

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-tag MCP notes | Add a tag to all AI-created notes | `true` |
| Auto-tag name | Tag name for AI-created notes | `MCP` |
| Journal entry prefix | Prefix for journal entries | `[Claude]` |
| Add timestamp to journal | Include time in journal entries | `true` |
| WebSocket server URL | MCP server connection URL | `ws://127.0.0.1:3002` |
| Default parent Rem ID | Parent for new notes (empty = root) | `` |

## MCP Tools Available

Once connected, your AI assistant can use these tools:

| Tool | Description |
|------|-------------|
| `remnote_create_note` | Create a new note with title, content, parent, and tags |
| `remnote_search` | Search the knowledge base with query and filters |
| `remnote_read_note` | Read a note's content and children by ID |
| `remnote_update_note` | Update title, append content, add/remove tags |
| `remnote_append_journal` | Add an entry to today's daily document |
| `remnote_status` | Check connection status |

## Example Usage

Once everything is connected, you can ask your AI assistant things like:

- *"Create a note about the meeting we just had"*
- *"Search my notes for information about project X"*
- *"Add a journal entry: Finished the MCP integration today!"*
- *"Find all my notes tagged with 'Ideas' and summarize them"*
- *"Update my 'Reading List' note with this new book"*

## Architecture

```
┌─────────────────┐     SSE/HTTP       ┌─────────────────┐
│   Claude App    │◄──────────────────►│   MCP Server    │
│ (Mobile/Desktop)│    /sse endpoint   │ (server/ dir)   │
└─────────────────┘                    └────────┬────────┘
                                               │
                                          WebSocket
                                          wss://:PORT
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

The MCP server bridges two protocols:
- **SSE (Server-Sent Events)** for Claude clients
- **WebSocket** for the RemNote plugin running in your browser

## Development

### Plugin (runs in RemNote)
```bash
# install dependencies
npm install

# run in dev mode (hot reload)
npm run dev

# build for production
npm run build
# output: PluginZip.zip
```

### Server (runs on Railway or locally)
```bash
cd server

# install dependencies
npm install

# run in dev mode
npm run dev

# build
npm run build

# run production
npm start
```

## Troubleshooting

### Plugin shows "Disconnected"
- Ensure YOUR MCP server is running (local or deployed)
- Check the WebSocket URL in RemNote plugin settings:
  - Local: `ws://127.0.0.1:3002`
  - Railway: `wss://your-app-name.up.railway.app` (use YOUR deployment URL)
- Verify your server is accessible: `curl https://your-app-name.up.railway.app/health`
- Look for errors in RemNote's developer console (Cmd+Option+I)

### "Invalid event setCustomCSS" errors
- These are cosmetic errors from development mode
- They don't affect functionality
- They won't appear in production builds

### Notes not appearing
- Check if a default parent ID is set (might be creating under a specific Rem)
- Verify the auto-tag setting isn't filtering your view

## Data Privacy

**Important:** This plugin sends your RemNote data to external services.

When you use this plugin:
- **RemNote data is transmitted** to the MCP server you configure (local or remote)
- **The MCP server forwards** this data to AI assistants (Claude, GPT, etc.) that you connect
- **Data includes** note titles, content, tags, and hierarchical structure based on the tools invoked

### What data is sent?

The plugin only sends data when:
1. You explicitly invoke an MCP tool (create, search, read, update notes)
2. The AI assistant requests access to your RemNote data

### Data flow:

```
RemNote (your browser) → MCP Server (your deployment) → AI Assistant (Claude/GPT)
```

### Security recommendations:

- **Deploy your own server** - Never share server URLs with other users
- **Each user needs their own deployment** - Sharing servers exposes data to others
- **Review tool calls** before allowing AI to execute them
- **Use local server** for maximum security (no internet transmission)
- **No data is stored** by the MCP server - it only bridges connections
- **Keep your server URL private** - Treat it like a password

### Why each user needs their own server:

The MCP server acts as a bridge between your RemNote and AI assistants. If multiple users connect to the same server, their data could potentially be mixed or exposed to each other. **Always deploy your own instance.**

By using this plugin, you acknowledge that your RemNote data will be transmitted to the services you configure.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

| Resource | URL |
|----------|-----|
| GitHub Repo | https://github.com/AlexHagemeister/remnote-mcp-bridge |
| Plugin Files (GitHub Pages) | https://alexhagemeister.github.io/remnote-mcp-bridge/ |
| Server Deployment Guide | [server/README.md](server/README.md) |

## Acknowledgments

- [RemNote](https://remnote.com) for the amazing PKM tool
- [Anthropic](https://anthropic.com) for Claude and the MCP protocol
- The RemNote plugin community for inspiration
- Original concept by [Quentin Tousart](https://github.com/quentintou)

---

**Made with Claude** - This plugin was developed in collaboration with Claude AI.
