#!/usr/bin/env npx tsx
import { initGlobalLogger } from '@metahuman/core'
import { runEventTrigger } from './core.js'
initGlobalLogger('body-event-trigger')
const input = JSON.parse(process.env.MH_TASK_PAYLOAD || '{}')
void runEventTrigger(undefined, input.observation,
  input.taskBrief || input.seed || process.argv.slice(2).join(' ')).then(result => {
    console.log(JSON.stringify(result))
  }).catch(error => { console.error(error); process.exitCode = 1 })
