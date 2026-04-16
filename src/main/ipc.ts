import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { getMcpStatuses, getAllMcpStatuses } from './mcp-manager'
import { spawnPty, writeToPty, resizePty, killPty } from './pty-manager'
import { listSessionRecords, readSessionLog, searchSessions } from './session-manager'
import {
  listAgents,
  getAgent,
  spawnAgent,
  resumeAgent,
  listSessions,
  removeSession,
  updateSessionStatus,
  createAgent,
  updateAgent,
  deleteAgent,
  createInstance,
  deleteInstance,
  updateInstanceTag,
  type CreateAgentInput
} from './agent-manager'
import { listFiles, readFileContent, downloadFile } from './file-manager'
import {
  listCrons,
  addCron,
  updateCron,
  deleteCron,
  type CronSchedule
} from './cron-manager'

export function registerIpcHandlers(): void {
  // PTY handlers
  ipcMain.handle('pty:write', (_event, sessionId: string, data: string) => {
    writeToPty(sessionId, data)
  })

  ipcMain.handle('pty:resize', (_event, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, sessionId: string) => {
    killPty(sessionId)
    removeSession(sessionId)
  })

  // Agent handlers
  ipcMain.handle('agent:list', () => listAgents())
  ipcMain.handle('agent:get', (_event, agentId: string) => getAgent(agentId))
  ipcMain.handle('agent:spawn', (_event, agentId: string, instanceId: string, args: Record<string, string>) =>
    spawnAgent(agentId, instanceId, args)
  )
  ipcMain.handle('agent:sessions', () => listSessions())
  ipcMain.handle('agent:create', (_event, input: CreateAgentInput) => {
    console.log('[ipc] agent:create received')
    return createAgent(input)
  })
  ipcMain.handle('agent:update', (_event, agentId: string, input: CreateAgentInput) =>
    updateAgent(agentId, input)
  )
  ipcMain.handle('agent:delete', (_event, agentId: string) => deleteAgent(agentId))
  ipcMain.handle('agent:resume', (_event, agentId: string, instanceId: string, claudeSessionId: string) =>
    resumeAgent(agentId, instanceId, claudeSessionId)
  )
  ipcMain.handle('agent:updateStatus', (_event, sessionId: string, status: string) => {
    updateSessionStatus(sessionId, status)
  })

  // Instance handlers
  ipcMain.handle('instance:create', (_event, agentId: string) => createInstance(agentId))
  ipcMain.handle('instance:delete', (_event, agentId: string, instanceId: string) =>
    deleteInstance(agentId, instanceId)
  )
  ipcMain.handle('instance:updateTag', (_event, agentId: string, instanceId: string, tag: string) =>
    updateInstanceTag(agentId, instanceId, tag)
  )

  // Session record handlers
  ipcMain.handle('sessions:list', () => listSessionRecords())
  ipcMain.handle('sessions:search', (_event, query: string, agentId?: string) =>
    searchSessions(query, agentId)
  )
  ipcMain.handle('sessions:readLog', (_event, sessionId: string, logDir: string) =>
    readSessionLog(sessionId, logDir)
  )

  // MCP status handlers
  ipcMain.handle('mcp:statuses', (_event, names: string[]) => getMcpStatuses(names))
  ipcMain.handle('mcp:all', () => getAllMcpStatuses())

  // Shell handlers
  ipcMain.handle('shell:openInCursor', (_event, path: string) => {
    spawn('open', ['-a', 'Cursor', path], { detached: true, stdio: 'ignore' }).unref()
  })

  ipcMain.handle('shell:openInTerminal', (_event, path: string) => {
    spawn('open', ['-a', 'Terminal', path], { detached: true, stdio: 'ignore' }).unref()
  })

  // File handlers
  ipcMain.handle('file:list', (_event, workingDir: string, subPath?: string) =>
    listFiles(workingDir, subPath)
  )
  ipcMain.handle('file:read', (_event, workingDir: string, filePath: string) =>
    readFileContent(workingDir, filePath)
  )
  ipcMain.handle('file:download', (_event, workingDir: string, filePath: string) =>
    downloadFile(workingDir, filePath)
  )

  // Cron handlers
  ipcMain.handle('cron:list', (_event, agentId: string) => listCrons(agentId))
  ipcMain.handle('cron:add', (_event, agentId: string, label: string, schedule: CronSchedule, args: Record<string, string>) =>
    addCron(agentId, label, schedule, args)
  )
  ipcMain.handle('cron:update', (_event, agentId: string, cronId: string, updates: { label?: string; schedule?: CronSchedule; args?: Record<string, string>; enabled?: boolean }) =>
    updateCron(agentId, cronId, updates)
  )
  ipcMain.handle('cron:delete', (_event, agentId: string, cronId: string) =>
    deleteCron(agentId, cronId)
  )
}
