import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export type McpStatus = 'connected' | 'needs-auth' | 'never-connected'

export interface McpStatusResult {
  name: string          // as passed in (e.g. "Linear")
  fullName: string      // as stored by Claude (e.g. "claude.ai Linear")
  status: McpStatus
}

// Claude Code prefixes all claude.ai-hosted MCPs with "claude.ai "
function toFullName(name: string): string {
  return name.startsWith('claude.ai ') ? name : `claude.ai ${name}`
}

async function readEverConnected(): Promise<string[]> {
  try {
    const raw = await readFile(join(homedir(), '.claude.json'), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.claudeAiMcpEverConnected) ? data.claudeAiMcpEverConnected : []
  } catch {
    return []
  }
}

async function readNeedsAuth(): Promise<Record<string, { timestamp: number }>> {
  try {
    const raw = await readFile(join(homedir(), '.claude', 'mcp-needs-auth-cache.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function getMcpStatuses(names: string[]): Promise<McpStatusResult[]> {
  const [everConnected, needsAuth] = await Promise.all([readEverConnected(), readNeedsAuth()])

  return names.map((name) => {
    const fullName = toFullName(name)
    let status: McpStatus

    if (!everConnected.includes(fullName)) {
      status = 'never-connected'
    } else if (fullName in needsAuth) {
      status = 'needs-auth'
    } else {
      status = 'connected'
    }

    return { name, fullName, status }
  })
}

export async function getAllMcpStatuses(): Promise<McpStatusResult[]> {
  const [everConnected, needsAuth] = await Promise.all([readEverConnected(), readNeedsAuth()])

  // Union of all known names
  const allFull = new Set([...everConnected, ...Object.keys(needsAuth)])

  return Array.from(allFull).map((fullName) => {
    const name = fullName.replace(/^claude\.ai /, '')
    let status: McpStatus

    if (!everConnected.includes(fullName)) {
      status = 'never-connected'
    } else if (fullName in needsAuth) {
      status = 'needs-auth'
    } else {
      status = 'connected'
    }

    return { name, fullName, status }
  })
}
