import { readFile, writeFile, mkdir } from 'fs/promises'
import { createReadStream } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import * as readline from 'readline'

const SWARM_DIR = join(homedir(), '.swarm')
const INDEX_PATH = join(SWARM_DIR, 'sessions-index.json')

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
  logDir: string   // directory containing <id>.log and <id>.txt
  claudeSessionId?: string  // UUID from ~/.claude/projects/ for --resume
}

async function loadIndex(): Promise<SessionRecord[]> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8')
    return JSON.parse(raw) as SessionRecord[]
  } catch {
    return []
  }
}

async function saveIndex(records: SessionRecord[]): Promise<void> {
  await mkdir(SWARM_DIR, { recursive: true })
  await writeFile(INDEX_PATH, JSON.stringify(records, null, 2), 'utf-8')
}

export async function addSessionRecord(record: SessionRecord): Promise<void> {
  const records = await loadIndex()
  records.unshift(record)  // newest first
  await saveIndex(records)
}

export async function closeSessionRecord(sessionId: string, endedAt: string, durationMs: number): Promise<void> {
  const records = await loadIndex()
  const updated = records.map((r) =>
    r.id === sessionId ? { ...r, endedAt, durationMs } : r
  )
  await saveIndex(updated)
}

export async function listSessionRecords(): Promise<SessionRecord[]> {
  return loadIndex()
}

export async function readSessionLog(sessionId: string, logDir: string): Promise<string> {
  const logPath = join(logDir, `${sessionId}.log`)
  try {
    return await readFile(logPath, 'utf-8')
  } catch {
    return ''
  }
}

// Same comprehensive regex used in session-logger.ts
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
    // If the .txt still has escape chars it was written by the old broken stripper — re-strip from .log
    if (content.includes('\x1b')) {
      const raw = await readFile(logPath, 'utf-8')
      content = stripAnsiForSearch(raw)
      // Rewrite the fixed .txt so future searches are fast
      await writeFile(txtPath, content, 'utf-8')
    }
    return content.toLowerCase().includes(query.toLowerCase())
  } catch {
    // Fall back to stripping the .log directly
    try {
      const raw = await readFile(logPath, 'utf-8')
      return stripAnsiForSearch(raw).toLowerCase().includes(query.toLowerCase())
    } catch {
      return false
    }
  }
}

export async function updateSessionClaudeId(sessionId: string, claudeSessionId: string): Promise<void> {
  const records = await loadIndex()
  const updated = records.map((r) =>
    r.id === sessionId ? { ...r, claudeSessionId } : r
  )
  await saveIndex(updated)
}

export async function searchSessions(query: string, agentId?: string): Promise<SessionRecord[]> {
  const records = await loadIndex()
  const filtered = agentId ? records.filter((r) => r.agentId === agentId) : records

  if (!query.trim()) return filtered

  const results: SessionRecord[] = []
  for (const record of filtered) {
    const matches = await searchSessionText(record.id, record.logDir, query)
    if (matches) results.push(record)
  }
  return results
}
