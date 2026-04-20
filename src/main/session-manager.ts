import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import {
  getSessions,
  getSessionsByAgent,
  createSession as repoCreateSession,
  updateSession,
  getSession as repoGetSession,
  type CreateSessionInput
} from './database/repositories'
import { getDatabase } from './database/supabase'
import { getUserId } from './database/user-store'

const CLAUDE_RESUME_RE = /claude\s+--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function extractClaudeSessionId(content: string): string | null {
  const match = content.match(CLAUDE_RESUME_RE)
  return match ? match[1] : null
}

function broadcastClaudeSessionId(sessionId: string, claudeSessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:claudeId', { sessionId, claudeSessionId })
  }
}

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
    id: record.id,
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

export interface SessionLogRead {
  raw: string
  claudeSessionId: string | null
}

export async function readSessionLog(sessionId: string, logDir: string): Promise<SessionLogRead> {
  const logPath = join(logDir, `${sessionId}.log`)
  const txtPath = join(logDir, `${sessionId}.txt`)
  let raw = ''
  try {
    raw = await readFile(logPath, 'utf-8')
  } catch {
    return { raw: '', claudeSessionId: null }
  }

  // Prefer the ANSI-stripped .txt for robust regex matching; fall back to raw.
  let textForParse = raw
  try {
    textForParse = await readFile(txtPath, 'utf-8')
  } catch { /* fall back to raw */ }

  const claudeSessionId = extractClaudeSessionId(textForParse) ?? extractClaudeSessionId(raw)

  if (claudeSessionId) {
    // Persist to DB if missing, then broadcast so any open SessionViewer updates.
    try {
      const row = await repoGetSession(sessionId)
      if (!row.claude_session_id) {
        await updateSession(sessionId, { claudeSessionId })
        broadcastClaudeSessionId(sessionId, claudeSessionId)
      }
    } catch {
      /* session row may not exist (legacy file, stale id) — skip persist */
    }
  }

  return { raw, claudeSessionId }
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

  const q = query.trim().toLowerCase()
  if (!q) return records

  const results: SessionRecord[] = []
  for (const record of records) {
    const metaHit =
      record.agentName?.toLowerCase().includes(q) ||
      record.instanceTag?.toLowerCase().includes(q) ||
      record.prompt?.toLowerCase().includes(q)
    if (metaHit || (await searchSessionText(record.id, record.logDir, q))) {
      results.push(record)
    }
  }
  return results
}

/**
 * Repairs stale session_records.log_dir values by recomputing from each session's
 * current instance.working_dir. Called on startup so paths stay correct after any
 * folder rename / migration. If agentId is given, only that agent's sessions are
 * touched — useful inside updateAgent's rename branch.
 */
export async function repairSessionLogDirs(agentId?: string): Promise<void> {
  const userId = getUserId()
  const db = getDatabase()

  let instancesQuery = db.from('agent_instances').select('id, working_dir').eq('user_id', userId)
  if (agentId) instancesQuery = instancesQuery.eq('agent_id', agentId)
  const { data: instances, error: ie } = await instancesQuery
  if (ie) throw ie
  const workingDirById = new Map<string, string>(
    ((instances || []) as Array<{ id: string; working_dir: string }>).map((i) => [i.id, i.working_dir])
  )

  let sessionsQuery = db
    .from('session_records')
    .select('id, log_dir, instance_id')
    .eq('user_id', userId)
    .not('instance_id', 'is', null)
  if (agentId) sessionsQuery = sessionsQuery.eq('agent_id', agentId)
  const { data: sessions, error: se } = await sessionsQuery
  if (se) throw se

  for (const row of ((sessions || []) as Array<{ id: string; log_dir: string; instance_id: string }>)) {
    const wd = workingDirById.get(row.instance_id)
    if (!wd) continue
    const expected = join(wd, 'sessions')
    if (row.log_dir !== expected) {
      const { error: ue } = await db
        .from('session_records')
        .update({ log_dir: expected })
        .eq('id', row.id)
        .eq('user_id', userId)
      if (ue) console.error('[repair] update log_dir failed:', ue)
    }
  }
}
