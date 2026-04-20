import { mkdir, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import {
  getCrons as repoGetCrons,
  createCron as repoCreateCron,
  updateCron as repoUpdateCron,
  deleteCron as repoDeleteCron,
  getInstances as repoGetInstances
} from './database/repositories'

const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')

export interface CronSchedule {
  minute?: number
  hour?: number
  weekday?: number
  day?: number
  month?: number
}

export interface CronDefinition {
  id: string
  label: string
  schedule: CronSchedule
  args: Record<string, string>
  enabled: boolean
  createdAt: string
}

// ─── DB row → app type mapper ───────────────────────────────────────────────

function dbRowToCron(row: Record<string, unknown>): CronDefinition {
  return {
    id: row.id as string,
    label: row.label as string,
    schedule: row.schedule as CronSchedule,
    args: (row.args as Record<string, string>) || {},
    enabled: row.enabled as boolean,
    createdAt: row.created_at as string
  }
}

// ─── launchd plist helpers ───────────────────────────────────────────────────

function plistLabel(agentId: string, cronId: string): string {
  return `com.swarm.cron.${agentId}.${cronId}`
}

function plistPath(agentId: string, cronId: string): string {
  return join(LAUNCH_AGENTS_DIR, `${plistLabel(agentId, cronId)}.plist`)
}

function buildPrompt(schedule: CronSchedule, args: Record<string, string>): string {
  const cadence = formatSchedule(schedule)
  const preamble = `You are being invoked automatically as a scheduled job (cadence: ${cadence}). There is no interactive user watching. Complete the task below autonomously, and exit, don't ask questions.`
  const argsText = Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(' | ')
  return argsText ? `${preamble}\n\n${argsText}` : preamble
}

async function getFirstInstanceDir(agentId: string): Promise<string | null> {
  const rows = await repoGetInstances(agentId)
  const first = rows.find((r) => r.ready as boolean)
  return first ? (first.working_dir as string) : null
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

  const script = `if [ -f "${lockFile}" ]; then echo "Skipping — session already running" >> "${logFile}"; exit 0; fi; mkdir -p "${logDir}" && touch "${lockFile}" && cd "${instanceDir}" && claude -p "${prompt.replace(/"/g, '\\"')}" >> "${logFile}" 2>&1; rm -f "${lockFile}"`

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
  const rows = await repoGetCrons(agentId)
  return rows.map(dbRowToCron)
}

export async function addCron(
  agentId: string,
  label: string,
  schedule: CronSchedule,
  args: Record<string, string>
): Promise<CronDefinition> {
  const dbRow = await repoCreateCron({
    agentId,
    label,
    schedule,
    args,
    enabled: true
  })

  const cron = dbRowToCron(dbRow)
  await installPlist(agentId, cron)
  return cron
}

export async function updateCron(
  agentId: string,
  cronId: string,
  updates: { label?: string; schedule?: CronSchedule; args?: Record<string, string>; enabled?: boolean }
): Promise<CronDefinition | null> {
  const dbRow = await repoUpdateCron(cronId, updates)
  const updated = dbRowToCron(dbRow)

  const label = plistLabel(agentId, cronId)
  unloadPlist(label)

  if (updated.enabled) {
    await installPlist(agentId, updated)
  } else {
    try { await unlink(plistPath(agentId, cronId)) } catch { /* ignore */ }
  }

  return updated
}

export async function deleteCron(agentId: string, cronId: string): Promise<void> {
  await repoDeleteCron(cronId)

  const label = plistLabel(agentId, cronId)
  unloadPlist(label)
  try { await unlink(plistPath(agentId, cronId)) } catch { /* ignore */ }
}

export async function deleteAllCrons(agentId: string): Promise<void> {
  const rows = await repoGetCrons(agentId)
  for (const row of rows) {
    const cronId = row.id as string
    const label = plistLabel(agentId, cronId)
    unloadPlist(label)
    try { await unlink(plistPath(agentId, cronId)) } catch { /* ignore */ }
    await repoDeleteCron(cronId)
  }
}

async function installPlist(agentId: string, cron: CronDefinition): Promise<void> {
  const instanceDir = await getFirstInstanceDir(agentId)
  if (!instanceDir) {
    console.error(`[cron-manager] no ready instance for agent ${agentId}, skipping plist install`)
    return
  }

  const label = plistLabel(agentId, cron.id)
  const prompt = buildPrompt(cron.schedule, cron.args)
  const plistContent = buildPlist(label, agentId, instanceDir, prompt, cron.schedule, cron.id)

  await mkdir(LAUNCH_AGENTS_DIR, { recursive: true })
  await writeFile(plistPath(agentId, cron.id), plistContent, 'utf-8')
  loadPlist(label)
}

export async function reinstallCrons(agentId: string): Promise<void> {
  const rows = await repoGetCrons(agentId)
  for (const row of rows) {
    const cron = dbRowToCron(row)
    if (cron.enabled) {
      const label = plistLabel(agentId, cron.id)
      unloadPlist(label)
      await installPlist(agentId, cron)
    }
  }
}

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
