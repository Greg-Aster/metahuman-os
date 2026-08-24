#!/usr/bin/env node
import process from 'node:process'
import { printHelp } from './help.js'

function requestedCommand(args: string[]): string {
  const filteredArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--user' || args[index] === '-u') {
      index += 1
      continue
    }
    filteredArgs.push(args[index])
  }

  return filteredArgs[0] ?? 'help'
}

const command = requestedCommand(process.argv.slice(2))

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp()
} else {
  await import('./main.js')
}
