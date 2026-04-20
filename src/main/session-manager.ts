import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getSessions,
  getSessionsByAgent,
  createSession as repoCreateSession,
  updateSession,
  type CreateSessionInput
} from './database/repositories'

export interface SessionRecord {
  id: string
  agentId: string
  agentName: string
  instanceId: string
  instanceIndex: number
  instanceTag?: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  prompt: string
  logDir: string
  claudeSessionId?: string
  marketplaceAgentId?: string
}

function dbRowToSessionRecord(row: Record<string, unknown>): SessionRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    agentName: row.agent_name as string,
    instanceId: row.instance_id as string,
    instanceIndex: row.instance_index as number,
    instanceTag: row.instance_tag as string | undefined,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | undefined,
    durationMs: row.duration_ms as number | undefined,
    prompt: row.prompt as string,
    logDir: row.log_dir as string,
    claudeSessionId: row.claude_session_id as string | undefined,
    marketplaceAgentId: (row.marketplace_agent_id as string | null) ?? undefined
  }
}

export async function addSessionRecord(
  record: SessionRecord & { marketplaceAgentId?: string }
): Promise<void> {
  const input: CreateSessionInput = {
    agentId: record.agentId,
    agentName: record.agentName,
    instanceId: record.instanceId,
    instanceIndex: record.instanceIndex,
    instanceTag: record.instanceTag,
    prompt: record.prompt,
    logDir: record.logDir,
    claudeSessionId: record.claudeSessionId,
    marketplaceAgentId: record.marketplaceAgentId
  }
  await repoCreateSession(input)
}

export async function closeSessionRecord(sessionId: string, endedAt: string, durationMs: number): Promise<void> {
  await updateSession(sessionId, { endedAt, durationMs })
}

export async function listSessionRecords(): Promise<SessionRecord[]> {
  const rows = await getSessions(500)
  return rows.map(dbRowToSessionRecord)
}

export async function readSessionLog(sessionId: string, logDir: string): Promise<string> {
  const logPath = join(logDir, `${sessionId}.log`)
  try {
    return await readFile(logPath, 'utf-8')
  } catch {
    return ''
  }
}

function stripAnsiForSearch(str: string): string {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[P^_X][^\x1b]*\x1b\\/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[\x20-\x7e]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\xc2[\x80-\x9f]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export async function searchSessionText(
  sessionId: string,
  logDir: string,
  query: string
): Promise<boolean> {
  const txtPath = join(logDir, `${sessionId}.txt`)
  const logPath = join(logDir, `${sessionId}.log`)
  try {
    let content = await readFile(txtPath, 'utf-8')
    if (content.includes('\x1b')) {
      const raw = await readFile(logPath, 'utf-8')
      content = stripAnsiForSearch(raw)
      await writeFile(txtPath, content, 'utf-8')
    }
    return content.toLowerCase().includes(query.toLowerCase())
  } catch {
    try {
      const raw = await readFile(logPath, 'utf-8')
      return stripAnsiForSearch(raw).toLowerCase().includes(query.toLowerCase())
    } catch {
      return false
    }
  }
}

export async function updateSessionClaudeId(sessionId: string, claudeSessionId: string): Promise<void> {
  await updateSession(sessionId, { claudeSessionId })
}

export async function searchSessions(query: string, agentId?: string): Promise<SessionRecord[]> {
  const rows = agentId ? await getSessionsByAgent(agentId) : await getSessions(500)
  const records = rows.map(dbRowToSessionRecord)

  if (!query.trim()) return records

  const results: SessionRecord[] = []
  for (const record of records) {
    const matches = await searchSessionText(record.id, record.logDir, query)
    if (matches) results.push(record)
  }
  return results
}
