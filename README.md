# Swarm

Agent management desktop app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Define specialized AI agents with custom instructions, spawn isolated instances with their own working directories, and manage multiple concurrent sessions — all from a single interface.

![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-macOS-000000?logo=apple&logoColor=white)

## Features

- **Agent definitions** — Create agents with structured CLAUDE.md files, custom permissions, argument schemas, and MCP server requirements
- **Isolated instances** — Each agent instance gets its own working directory with automatic GitHub repo cloning
- **Live terminal** — Full interactive terminal (xterm.js + node-pty) for each running session with real-time status detection (idle / thinking / waiting)
- **Session history** — All sessions are logged and searchable. Resume any past session using Claude Code's `--resume` flag
- **File browser** — Browse and preview files in any instance's working directory
- **MCP integration** — Pre-launch connectivity checks for required MCP servers
- **Multi-tab interface** — Run and monitor multiple sessions simultaneously with tab management

## Prerequisites

- **macOS** (primary supported platform)
- **Node.js** >= 18
- **npm** >= 9
- **Claude Code CLI** installed and available in your PATH (`claude` command)

## Getting Started

### Install dependencies

```bash
npm install
```

### Run in development mode

```bash
npm run dev
```

This starts electron-vite in dev mode with hot-reload for the renderer (Svelte UI).

### Build the application

```bash
# Compile TypeScript and bundle the app
npm run build

# Package into a distributable directory (no installer)
npm run pack

# Build a full distributable (DMG on macOS)
npm run dist
```

After running `npm run dist`, the built application will be in the `dist/` directory.

## Usage

### Creating an agent

1. Click the **+** button in the sidebar to open the agent editor
2. Fill in the agent definition:
   - **Name & emoji** — Display name and icon
   - **Description** — What the agent does
   - **Instructions** — The CLAUDE.md content that defines the agent's behavior
   - **Arguments** — Input parameters the agent accepts at launch (with optional validation, defaults, and radio options)
   - **Allowed commands** — Shell commands whitelisted via Claude Code's `settings.local.json`
   - **MCP requirements** — MCP servers the agent depends on
   - **Repos** — GitHub repositories to auto-clone into instance working directories
3. Save the agent

### Managing instances

Each agent can have multiple **instances** — isolated working directories where sessions run.

- Click the **+** next to an agent to create a new instance
- If the agent has configured repos, they are cloned automatically (progress is shown in the sidebar)
- Each instance can be tagged for easy identification
- Open an instance directory in Terminal or your editor via the sidebar buttons

### Running sessions

1. Click the **play button** (▶) on an instance to launch a new session
2. If the agent has arguments, a dialog appears to fill them in
3. MCP server connectivity is verified before launch
4. A new terminal tab opens with Claude Code running under the agent's instructions
5. The status badge shows real-time state: **idle**, **thinking**, or **waiting** (needs input)
6. Type directly in the terminal to interact with the session

### Session history

- Switch to the **Sessions** tab in the sidebar to see all past sessions
- Search across session logs by keyword
- Click a session to view its log output
- Resume a previous session — Swarm uses Claude Code's `--resume` with the stored session ID

## Project Structure

```
src/
├── main/                          # Electron main process
│   ├── index.ts                   # Window setup, menus, keyboard shortcuts
│   ├── ipc.ts                     # IPC handler registration
│   ├── agent-manager.ts           # Agent CRUD, instance lifecycle, session spawning
│   ├── pty-manager.ts             # PTY process management, status detection
│   ├── session-manager.ts         # Session index, search, metadata
│   ├── session-logger.ts          # Raw + plain-text log writing
│   ├── mcp-manager.ts             # MCP server status detection
│   └── file-manager.ts            # File listing, reading, downloading
├── renderer/                      # Svelte 5 frontend
│   └── src/
│       ├── App.svelte             # Root component
│       └── lib/
│           ├── components/        # UI components (Sidebar, Terminal, Modals, etc.)
│           └── stores/            # Svelte stores (agents, sessions, UI state)
└── preload/                       # Electron context bridge
```

### Data directory

All agent data is stored in `~/.swarm/`:

```
~/.swarm/
├── CLAUDE.md                      # Base rules injected into all agents
├── sessions-index.json            # Metadata index for all past sessions
└── agents/
    └── <agent-id>/
        ├── CLAUDE.md              # Agent definition (frontmatter + instructions)
        ├── .claude/settings.local.json
        ├── instances.json
        └── instances/
            └── <index>/           # Instance working directory
                ├── <cloned-repos>/
                └── sessions/      # Session logs (.log raw, .txt plain)
```

## Building for Distribution

### Unsigned (local use)

```bash
npm run dist
```

This produces an unsigned `.dmg` in `dist/`. Recipients will need to right-click > Open to bypass Gatekeeper.

### Signed & Notarized (public distribution)

To distribute without Gatekeeper warnings, you need an [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year).

1. **Set environment variables** for code signing:

   ```bash
   export CSC_NAME="Developer ID Application: Your Name (TEAM_ID)"
   ```

2. **Add notarization credentials** (App Store Connect API key or Apple ID):

   ```bash
   export APPLE_ID="your@email.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="YOUR_TEAM_ID"
   ```

3. **Update `package.json`** build config to enable notarization:

   ```json
   {
     "build": {
       "mac": {
         "hardenedRuntime": true,
         "entitlements": "build/entitlements.mac.plist",
         "entitlementsInherit": "build/entitlements.mac.plist"
       },
       "afterSign": "electron-builder-notarize"
     }
   }
   ```

4. **Create entitlements file** at `build/entitlements.mac.plist`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>com.apple.security.cs.allow-jit</key>
     <true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
     <true/>
     <key>com.apple.security.cs.allow-dyld-environment-variables</key>
     <true/>
   </dict>
   </plist>
   ```

5. **Build**:

   ```bash
   npm run dist
   ```

> **Note**: Publishing to the Mac App Store is not recommended for this app. Swarm relies on `node-pty` to spawn shell processes and invoke `claude`, which conflicts with App Store sandboxing requirements. Direct distribution with notarization is the practical path.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Electron](https://www.electronjs.org/) 35 |
| Build | [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/) |
| Frontend | [Svelte](https://svelte.dev/) 5 |
| Terminal | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/nicknisi/node-pty) |
| Language | TypeScript |

## License

Private — all rights reserved.
