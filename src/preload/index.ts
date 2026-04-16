import { contextBridge, ipcRenderer } from 'electron'

export interface CreateAgentInput {
  name: string
  emoji: string
  description: string
  useWhen: string
  claudeMdBody: string
  args: { name: string; description: string; required: boolean; default?: string; options?: string[] }[]
  mcpRequirements: string[]
  allowedCommands: string[]
  repos: { name: string; url: string }[]
}

const api = {
  // PTY
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.invoke('pty:write', sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', sessionId, cols, rows),
  ptyKill: (sessionId: string) => ipcRenderer.invoke('pty:kill', sessionId),

  onPtyData: (callback: (data: { instanceId: string; data: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { instanceId: string; data: string }) => callback(data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },

  onPtyExit: (callback: (data: { instanceId: string; exitCode: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { instanceId: string; exitCode: number }) => callback(data)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },

  onPtyStatus: (callback: (data: { instanceId: string; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { instanceId: string; status: string }) => callback(data)
    ipcRenderer.on('pty:status', handler)
    return () => ipcRenderer.removeListener('pty:status', handler)
  },

  // Agents
  agentList: () => ipcRenderer.invoke('agent:list'),
  agentGet: (agentId: string) => ipcRenderer.invoke('agent:get', agentId),
  agentSpawn: (agentId: string, instanceId: string, args: Record<string, string>) =>
    ipcRenderer.invoke('agent:spawn', agentId, instanceId, args),
  agentSessions: () => ipcRenderer.invoke('agent:sessions'),
  agentCreate: (input: CreateAgentInput) => ipcRenderer.invoke('agent:create', input),
  agentUpdate: (agentId: string, input: CreateAgentInput) =>
    ipcRenderer.invoke('agent:update', agentId, input),
  agentDelete: (agentId: string) => ipcRenderer.invoke('agent:delete', agentId),
  agentResume: (agentId: string, instanceId: string, claudeSessionId: string) =>
    ipcRenderer.invoke('agent:resume', agentId, instanceId, claudeSessionId),
  onCloneProgress: (callback: (data: { instanceId: string; repo: string; status: string; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { instanceId: string; repo: string; status: string; error?: string }) => callback(data)
    ipcRenderer.on('agent:cloneProgress', handler)
    return () => ipcRenderer.removeListener('agent:cloneProgress', handler)
  },

  // Instances
  instanceCreate: (agentId: string) => ipcRenderer.invoke('instance:create', agentId),
  instanceDelete: (agentId: string, instanceId: string) =>
    ipcRenderer.invoke('instance:delete', agentId, instanceId),
  instanceUpdateTag: (agentId: string, instanceId: string, tag: string) =>
    ipcRenderer.invoke('instance:updateTag', agentId, instanceId, tag),

  onInstanceReady: (callback: (data: { agentId: string; instanceId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; instanceId: string }) => callback(data)
    ipcRenderer.on('instance:ready', handler)
    return () => ipcRenderer.removeListener('instance:ready', handler)
  },

  onSessionClaudeId: (callback: (data: { sessionId: string; claudeSessionId: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; claudeSessionId: string }) => callback(data)
    ipcRenderer.on('session:claudeId', handler)
    return () => ipcRenderer.removeListener('session:claudeId', handler)
  },

  // Shortcuts
  onShortcut: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('shortcut', handler)
    return () => ipcRenderer.removeListener('shortcut', handler)
  },

  // Session records
  sessionsList: () => ipcRenderer.invoke('sessions:list'),
  sessionsSearch: (query: string, agentId?: string) =>
    ipcRenderer.invoke('sessions:search', query, agentId),
  sessionsReadLog: (sessionId: string, logDir: string) =>
    ipcRenderer.invoke('sessions:readLog', sessionId, logDir),

  // Shell
  // MCP
  mcpStatuses: (names: string[]) => ipcRenderer.invoke('mcp:statuses', names),
  mcpAll: () => ipcRenderer.invoke('mcp:all'),

  openInCursor: (path: string) => ipcRenderer.invoke('shell:openInCursor', path),
  openInTerminal: (path: string) => ipcRenderer.invoke('shell:openInTerminal', path),

  // Files
  fileList: (workingDir: string, subPath?: string) =>
    ipcRenderer.invoke('file:list', workingDir, subPath),
  fileRead: (workingDir: string, filePath: string) =>
    ipcRenderer.invoke('file:read', workingDir, filePath),
  fileDownload: (workingDir: string, filePath: string) =>
    ipcRenderer.invoke('file:download', workingDir, filePath),

  // Crons
  cronList: (agentId: string) => ipcRenderer.invoke('cron:list', agentId),
  cronAdd: (agentId: string, label: string, schedule: Record<string, number | undefined>, args: Record<string, string>) =>
    ipcRenderer.invoke('cron:add', agentId, label, schedule, args),
  cronUpdate: (agentId: string, cronId: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('cron:update', agentId, cronId, updates),
  cronDelete: (agentId: string, cronId: string) =>
    ipcRenderer.invoke('cron:delete', agentId, cronId)
}

contextBridge.exposeInMainWorld('api', api)

export type SwarmAPI = typeof api
