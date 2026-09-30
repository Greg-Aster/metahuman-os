import { runTrainingEntryPoint } from './full-cycle.js'

runTrainingEntryPoint('fine-tune').catch(error => {
  console.error('[fine-tune-cycle] failed:', error)
  process.exitCode = 1
})
