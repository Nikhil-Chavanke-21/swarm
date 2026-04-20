import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { startSessionLog, writeSessionLog, endSessionLog } from './session-logger'

interface PtySession {
  process: pty.IPty
  instanceId: string
}

const sessions = new Map<string, PtySession>()

// Status detection state per instance
const statusState = new Map<string, {
  lastDataTime: number
  status: 'idle' | 'thinking' | 'waiting' | 'error'
  checkInterval: ReturnType<typeof setInterval> | null
}>()

function detectStatus(instanceId: string, data: string): 'idle' | 'thinking' | 'waiting' | 'error' {
  const state = statusState.get(instanceId)
  if (!state) return 'idle'

  state.lastDataTime = Date.now()

  // Claude Code permission/question patterns
  const waitingPatterns = [
    /Do you want to proceed/i,
    /\? \(y\/n\)/,
    /\? \[Y\/n\]/,
    /Allow\s/,
    /Deny\s/,
    /Press enter/i,
    /waiting for input/i,
    /❯/,
    /\(yes\/no\)/i
  ]

  for (const pattern of waitingPatterns) {
    if (pattern.test(data)) {
      return 'waiting'
    }
  }

  return 'thinking'
}

function broadcastStatus(instanceId: string, status: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('pty:status', { instanceId, status })
  }
}

function getUserPath(): string {
  // Electron doesn't inherit the user's full PATH — build it
  const home = process.env.HOME || ''
  const extra = [
    `${home}/.local/bin`,
    `${home}/.nvm/versions/node/v18.12.1/bin`,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin'
  ]
  const existing = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
  const parts = existing.split(':')
  for (const p of extra) {
    if (!parts.includes(p)) parts.unshift(p)
  }
  return parts.join(':')
}

export function spawnPty(
  instanceId: string,
  cwd: string,
  command: string,
  args: string[],
  initialMessage?: string,
  logDir?: string,
  onExitCallback?: (exitCode: number) => void
): void {
  const shell = process.env.SHELL || '/bin/zsh'

  const proc = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', PATH: getUserPath() }
  })

  sessions.set(instanceId, { process: proc, instanceId })

  if (logDir) startSessionLog(instanceId, logDir)

  // Set up status tracking
  const state = {
    lastDataTime: Date.now(),
    status: 'idle' as const,
    checkInterval: setInterval(() => {
      const s = statusState.get(instanceId)
      if (!s) return
      const elapsed = Date.now() - s.lastDataTime
      // If no data for 2 seconds and was thinking, switch to waiting or idle
      if (elapsed > 2000 && s.status === 'thinking') {
        s.status = 'waiting'
        broadcastStatus(instanceId, 'waiting')
      }
      if (elapsed > 10000 && s.status === 'waiting') {
        // Long silence — likely idle
        s.status = 'idle'
        broadcastStatus(instanceId, 'idle')
      }
    }, 1000)
  }
  statusState.set(instanceId, state)

  proc.onData((data) => {
    const newStatus = detectStatus(instanceId, data)
    const currentState = statusState.get(instanceId)
    if (currentState && currentState.status !== newStatus) {
      currentState.status = newStatus
      broadcastStatus(instanceId, newStatus)
    }

    writeSessionLog(instanceId, data)

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('pty:data', { instanceId, data })
    }
  })

  proc.onExit(({ exitCode }) => {
    const s = statusState.get(instanceId)
    if (s?.checkInterval) clearInterval(s.checkInterval)
    statusState.delete(instanceId)
    sessions.delete(instanceId)

    endSessionLog(instanceId)

    const status = exitCode === 0 ? 'idle' : 'error'
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('pty:exit', { instanceId, exitCode })
      win.webContents.send('pty:status', { instanceId, status })
    }

    onExitCallback?.(exitCode)
  })

  const fullCommand = [command, ...args].join(' ')

  console.log(`[pty] scheduling command: ${fullCommand}`)
  console.log(`[pty] initialMessage: ${initialMessage ? initialMessage.slice(0, 80) + '...' : '(none)'}`)

  setTimeout(() => {
    console.log('[pty] typing command into shell')
    proc.write(fullCommand + '\r')

    if (initialMessage) {
      setTimeout(() => {
        console.log('[pty] typing initial message into claude')
        proc.write(initialMessage + '\r')
      }, 3500)
    }
  }, 800)
}

export function writeToPty(instanceId: string, data: string): void {
  const session = sessions.get(instanceId)
  if (session) {
    session.process.write(data)
  }
}

export function resizePty(instanceId: string, cols: number, rows: number): void {
  const session = sessions.get(instanceId)
  if (session) {
    session.process.resize(cols, rows)
  }
}

export function killPty(instanceId: string): void {
  const session = sessions.get(instanceId)
  if (session) {
    session.process.kill()
    const s = statusState.get(instanceId)
    if (s?.checkInterval) clearInterval(s.checkInterval)
    statusState.delete(instanceId)
    sessions.delete(instanceId)
  }
}

export function getAllSessions(): string[] {
  return Array.from(sessions.keys())
}
