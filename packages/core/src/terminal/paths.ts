import path from 'node:path'
import { systemPaths } from '../path-builder.js'

export const terminalDirectory = path.join(systemPaths.run, 'terminal')
export const terminalSocket = path.join(terminalDirectory, 'service.sock')
export const terminalReceipts = path.join(terminalDirectory, 'processes')
export const terminalJobs = path.join(terminalDirectory, 'jobs')
