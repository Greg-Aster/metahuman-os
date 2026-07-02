import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const budgets = {
  browserBytes: 140 * 1024,
  serverBytes: 100 * 1024,
  clientJsBytes: 90 * 1024,
}

const browserDir = path.join(root, 'dist')
const serverDir = path.join(root, 'dist-server')

function fileSize(filePath) {
  return fs.statSync(filePath).size
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function totalBytes(dir) {
  return walkFiles(dir).reduce((sum, filePath) => sum + fileSize(filePath), 0)
}

function fail(message) {
  console.error(`[robot-friend:size] ${message}`)
  process.exitCode = 1
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

const browserBytes = totalBytes(browserDir)
const serverBytes = totalBytes(serverDir)
const clientJsBytes = walkFiles(browserDir)
  .filter((filePath) => filePath.endsWith('.js'))
  .reduce((sum, filePath) => sum + fileSize(filePath), 0)

console.log(
  `[robot-friend:size] browser=${format(browserBytes)} server=${format(serverBytes)} client-js=${format(clientJsBytes)}`,
)

if (browserBytes > budgets.browserBytes) {
  fail(`browser build exceeds ${format(budgets.browserBytes)}`)
}

if (serverBytes > budgets.serverBytes) {
  fail(`server build exceeds ${format(budgets.serverBytes)}`)
}

if (clientJsBytes > budgets.clientJsBytes) {
  fail(`client JS exceeds ${format(budgets.clientJsBytes)}`)
}
