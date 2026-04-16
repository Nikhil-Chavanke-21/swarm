import { readdir, readFile, copyFile, mkdir, stat } from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'

const DOWNLOADS_DIR = join(homedir(), 'Downloads', 'swarm')

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export async function listFiles(workingDir: string, subPath: string = ''): Promise<FileEntry[]> {
  const baseDir = subPath ? join(workingDir, subPath) : workingDir
  const entries: FileEntry[] = []

  try {
    const dirEntries = await readdir(baseDir, { withFileTypes: true })
    for (const entry of dirEntries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(baseDir, entry.name)
      const stats = await stat(fullPath)
      entries.push({
        name: entry.name,
        path: subPath ? `${subPath}/${entry.name}` : entry.name,
        isDirectory: entry.isDirectory(),
        size: stats.size
      })
    }
  } catch {
    // Directory might not exist
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function readFileContent(workingDir: string, filePath: string): Promise<string> {
  return readFile(join(workingDir, filePath), 'utf-8')
}

export async function downloadFile(workingDir: string, filePath: string): Promise<string> {
  const sourcePath = join(workingDir, filePath)
  const label = workingDir.split('/').slice(-3).join('-')
  const destDir = join(DOWNLOADS_DIR, label)
  await mkdir(destDir, { recursive: true })
  const destPath = join(destDir, basename(filePath))
  await copyFile(sourcePath, destPath)
  return destPath
}
