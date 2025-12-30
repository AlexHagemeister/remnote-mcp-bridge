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

## Quick Start (Remote/Claude Mobile)

Deploy the MCP server to Railway for Claude Mobile access:

```bash
cd server
railway login
railway init
railway up
```

Your SSE endpoint: `https://your-app.up.railway.app/sse`

See [server/README.md](server/README.md) for full deployment guide.

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

### 2. Run the MCP Server

The MCP server is included in the `server/` directory:

```bash
cd server
npm install
npm run dev
```

### 3. Configure Your AI Assistant

#### For Claude Desktop (SSE Remote)
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "remnote": {
      "url": "https://your-app.up.railway.app/sse"
    }
  }
}
```

#### For Claude Desktop (Local)
```json
{
  "mcpServers": {
    "remnote": {
      "url": "http://localhost:3002/sse"
    }
  }
}
```

#### For Claude Mobile
Add MCP server with URL:
```
https://your-app.up.railway.app/sse
```

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
- Ensure the MCP server is running (`cd server && npm run dev`)
- Check the WebSocket URL in settings:
  - Local: `ws://127.0.0.1:3002`
  - Railway: `wss://your-app.up.railway.app`
- Look for errors in RemNote's developer console (Cmd+Option+I)

### "Invalid event setCustomCSS" errors
- These are cosmetic errors from development mode
- They don't affect functionality
- They won't appear in production builds

### Notes not appearing
- Check if a default parent ID is set (might be creating under a specific Rem)
- Verify the auto-tag setting isn't filtering your view

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
| Demo Railway Server | https://remnote-mcp-production.up.railway.app |

## Acknowledgments

- [RemNote](https://remnote.com) for the amazing PKM tool
- [Anthropic](https://anthropic.com) for Claude and the MCP protocol
- The RemNote plugin community for inspiration
- Original concept by [Quentin Tousart](https://github.com/quentintou)

---

**Made with Claude** - This plugin was developed in collaboration with Claude AI.
