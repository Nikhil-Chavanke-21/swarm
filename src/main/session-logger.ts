import { createWriteStream, WriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// Strip all terminal escape sequences to produce plain searchable text.
// Handles the full range of VT100/xterm/ANSI sequences that Claude Code emits.
function stripAnsi(str: string): string {
  return str
    // CSI sequences: ESC [ <param bytes> <intermediate bytes> <final byte>
    // Param bytes: 0x30-0x3f (includes digits, ;, :, <, =, >, ?)
    // Intermediate bytes: 0x20-0x2f (space, !, ", #, $, %, &, ', (, ), *, +, ,, -, ., /)
    // Final byte: 0x40-0x7e
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
    // OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC \
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // DCS / PM / APC / SOS: ESC [P^_X] ... ESC \
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[P^_X][^\x1b]*\x1b\\/g, '')
    // Simple two-byte sequences: ESC <single char> (RIS, IND, NEL, SS2, SS3, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[\x20-\x7e]/g, '')
    // Any remaining lone ESC
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b/g, '')
    // UTF-8 encoded C1 control characters (0xC2 0x80–0x9F)
    // eslint-disable-next-line no-control-regex
    .replace(/\xc2[\x80-\x9f]/g, '')
    // Strip remaining ASCII control chars except CR, LF, tab
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    // Normalize CR+LF and bare CR to LF
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

interface LogStreams {
  raw: WriteStream
  txt: WriteStream
}

const streams = new Map<string, LogStreams>()

export function startSessionLog(sessionId: string, logDir: string): void {
  mkdirSync(logDir, { recursive: true })

  const rawPath = join(logDir, `${sessionId}.log`)
  const txtPath = join(logDir, `${sessionId}.txt`)

  const raw = createWriteStream(rawPath, { flags: 'a' })
  const txt = createWriteStream(txtPath, { flags: 'a' })

  streams.set(sessionId, { raw, txt })
}

export function writeSessionLog(sessionId: string, data: string): void {
  const s = streams.get(sessionId)
  if (!s) return
  s.raw.write(data)
  s.txt.write(stripAnsi(data))
}

export function endSessionLog(sessionId: string): void {
  const s = streams.get(sessionId)
  if (!s) return
  s.raw.end()
  s.txt.end()
  streams.delete(sessionId)
}
