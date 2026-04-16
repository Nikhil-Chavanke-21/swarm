import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { v4 as uuid } from 'uuid'

const SWARM_DIR = join(homedir(), '.swarm')
const AGENTS_DIR = join(SWARM_DIR, 'agents')
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')

export interface CronSchedule {
  minute?: number    // 0-59
  hour?: number      // 0-23
  weekday?: number   // 0=Sunday, 1=Monday, ... 6=Saturday
  day?: number       // 1-31
  month?: number     // 1-12
}

export interface CronDefinition {
  id: string
  label: string
  schedule: CronSchedule
  args: Record<string, string>
  enabled: boolean
  createdAt: string
}

// ─── crons.json helpers ──────────────────────────────────────────────────────

function cronsFilePath(agentId: string): string {
  return join(AGENTS_DIR, agentId, 'crons.json')
}

async function loadCrons(agentId: string): Promise<CronDefinition[]> {
  try {
    const raw = await readFile(cronsFilePath(agentId), 'utf-8')
    return JSON.parse(raw) as CronDefinition[]
  } catch {
    return []
  }
}

async function saveCrons(agentId: string, crons: CronDefinition[]): Promise<void> {
  await writeFile(cronsFilePath(agentId), JSON.stringify(crons, null, 2), 'utf-8')
}

// ─── launchd plist helpers ───────────────────────────────────────────────────

function plistLabel(agentId: string, cronId: string): string {
  return `com.swarm.cron.${agentId}.${cronId}`
}

function plistPath(agentId: string, cronId: string): string {
  return join(LAUNCH_AGENTS_DIR, `${plistLabel(agentId, cronId)}.plist`)
}

function buildPrompt(args: Record<string, string>): string {
  if (Object.keys(args).length === 0) return ''
  return Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(' | ')
}

/**
 * Find the first ready instance for an agent.
 * Returns the working directory or null.
 */
async function getFirstInstanceDir(agentId: string): Promise<string | null> {
  const instancesPath = join(AGENTS_DIR, agentId, 'instances.json')
  try {
    const raw = await readFile(instancesPath, 'utf-8')
    const instances = JSON.parse(raw) as { id: string; workingDir: string; ready: boolean }[]
    const first = instances.find((i) => i.ready)
    return first?.workingDir ?? null
  } catch {
    return null
  }
}

function buildCalendarInterval(schedule: CronSchedule): string {
  const entries: string[] = []
  if (schedule.month !== undefined) entries.push(`    <key>Month</key>\n    <integer>${schedule.month}</integer>`)
  if (schedule.day !== undefined) entries.push(`    <key>Day</key>\n    <integer>${schedule.day}</integer>`)
  if (schedule.weekday !== undefined) entries.push(`    <key>Weekday</key>\n    <integer>${schedule.weekday}</integer>`)
  if (schedule.hour !== undefined) entries.push(`    <key>Hour</key>\n    <integer>${schedule.hour}</integer>`)
  if (schedule.minute !== undefined) entries.push(`    <key>Minute</key>\n    <integer>${schedule.minute}</integer>`)
  return entries.join('\n')
}

function buildPlist(
  label: string,
  agentId: string,
  instanceDir: string,
  prompt: string,
  schedule: CronSchedule,
  cronId: string
): string {
  const lockFile = join(instanceDir, 'sessions', '.lock')
  const logDir = join(instanceDir, 'sessions')
  const sessionId = `cron-${cronId}-$(date +%s)`
  const logFile = join(logDir, `cron-${cronId}.log`)

  // The shell script:
  // 1. Check lock file — skip if another session is running
  // 2. Create lock file
  // 3. Run claude -p "prompt" in the instance directory
  // 4. Remove lock file
  const script = prompt
    ? `if [ -f "${lockFile}" ]; then echo "Skipping — session already running" >> "${logFile}"; exit 0; fi; mkdir -p "${logDir}" && touch "${lockFile}" && cd "${instanceDir}" && claude -p "${prompt.replace(/"/g, '\\"')}" >> "${logFile}" 2>&1; rm -f "${lockFile}"`
    : `if [ -f "${lockFile}" ]; then echo "Skipping — session already running" >> "${logFile}"; exit 0; fi; mkdir -p "${logDir}" && touch "${lockFile}" && cd "${instanceDir}" && claude -p "Run your default workflow." >> "${logFile}" 2>&1; rm -f "${lockFile}"`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-l</string>
    <string>-c</string>
    <string>${escapeXml(script)}</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
${buildCalendarInterval(schedule)}
  </dict>

  <key>StandardOutPath</key>
  <string>${logFile}</string>

  <key>StandardErrorPath</key>
  <string>${logFile}</string>

  <key>WorkingDirectory</key>
  <string>${instanceDir}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.HOME}/.local/bin:${process.env.HOME}/.nvm/versions/node/v18.12.1/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${process.env.HOME}</string>
  </dict>
</dict>
</plist>`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function loadPlist(label: string): void {
  try {
    execSync(`launchctl bootout gui/$(id -u) ${label} 2>/dev/null || true`, { stdio: 'ignore' })
  } catch { /* ignore — might not be loaded */ }
  try {
    const path = join(LAUNCH_AGENTS_DIR, `${label}.plist`)
    execSync(`launchctl bootstrap gui/$(id -u) "${path}"`, { stdio: 'ignore' })
  } catch (err) {
    console.error(`[cron-manager] failed to bootstrap ${label}:`, err)
  }
}

function unloadPlist(label: string): void {
  try {
    execSync(`launchctl bootout gui/$(id -u) ${label}`, { stdio: 'ignore' })
  } catch { /* ignore */ }
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function listCrons(agentId: string): Promise<CronDefinition[]> {
  return loadCrons(agentId)
}

export async function addCron(
  agentId: string,
  label: string,
  schedule: CronSchedule,
  args: Record<string, string>
): Promise<CronDefinition> {
  const cron: CronDefinition = {
    id: uuid(),
    label,
    schedule,
    args,
    enabled: true,
    createdAt: new Date().toISOString()
  }

  const crons = await loadCrons(agentId)
  crons.push(cron)
  await saveCrons(agentId, crons)

  // Install and load the launchd plist
  await installPlist(agentId, cron)

  return cron
}

export async function updateCron(
  agentId: string,
  cronId: string,
  updates: { label?: string; schedule?: CronSchedule; args?: Record<string, string>; enabled?: boolean }
): Promise<CronDefinition | null> {
  const crons = await loadCrons(agentId)
  const idx = crons.findIndex((c) => c.id === cronId)
  if (idx === -1) return null

  const old = crons[idx]
  const updated = { ...old, ...updates }
  crons[idx] = updated
  await saveCrons(agentId, crons)

  // Reinstall plist with new settings
  const label = plistLabel(agentId, cronId)
  unloadPlist(label)

  if (updated.enabled) {
    await installPlist(agentId, updated)
  } else {
    // Remove plist file when disabled
    try { await unlink(plistPath(agentId, cronId)) } catch { /* ignore */ }
  }

  return updated
}

export async function deleteCron(agentId: string, cronId: string): Promise<void> {
  const crons = await loadCrons(agentId)
  const remaining = crons.filter((c) => c.id !== cronId)
  await saveCrons(agentId, remaining)

  // Unload and remove plist
  const label = plistLabel(agentId, cronId)
  unloadPlist(label)
  try { await unlink(plistPath(agentId, cronId)) } catch { /* ignore */ }
}

export async function deleteAllCrons(agentId: string): Promise<void> {
  const crons = await loadCrons(agentId)
  for (const cron of crons) {
    const label = plistLabel(agentId, cron.id)
    unloadPlist(label)
    try { await unlink(plistPath(agentId, cron.id)) } catch { /* ignore */ }
  }
  await saveCrons(agentId, [])
}

async function installPlist(agentId: string, cron: CronDefinition): Promise<void> {
  const instanceDir = await getFirstInstanceDir(agentId)
  if (!instanceDir) {
    console.error(`[cron-manager] no ready instance for agent ${agentId}, skipping plist install`)
    return
  }

  const label = plistLabel(agentId, cron.id)
  const prompt = buildPrompt(cron.args)
  const plistContent = buildPlist(label, agentId, instanceDir, prompt, cron.schedule, cron.id)

  await mkdir(LAUNCH_AGENTS_DIR, { recursive: true })
  await writeFile(plistPath(agentId, cron.id), plistContent, 'utf-8')
  loadPlist(label)
}

/**
 * Reinstall all enabled crons for an agent (e.g. after instance changes).
 */
export async function reinstallCrons(agentId: string): Promise<void> {
  const crons = await loadCrons(agentId)
  for (const cron of crons) {
    if (cron.enabled) {
      const label = plistLabel(agentId, cron.id)
      unloadPlist(label)
      await installPlist(agentId, cron)
    }
  }
}

/**
 * Format a CronSchedule into a human-readable string.
 */
export function formatSchedule(schedule: CronSchedule): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const parts: string[] = []

  if (schedule.weekday !== undefined) parts.push(days[schedule.weekday])
  if (schedule.hour !== undefined && schedule.minute !== undefined) {
    parts.push(`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`)
  } else if (schedule.hour !== undefined) {
    parts.push(`${String(schedule.hour).padStart(2, '0')}:00`)
  } else if (schedule.minute !== undefined) {
    parts.push(`every hour at :${String(schedule.minute).padStart(2, '0')}`)
  }

  return parts.join(' ') || 'every minute'
}
