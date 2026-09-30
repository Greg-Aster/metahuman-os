import { runTrainingEntryPoint } from './full-cycle.js'

runTrainingEntryPoint('local-lora').catch(error => {
  console.error('[full-cycle-local] failed:', error)
  process.exitCode = 1
})
