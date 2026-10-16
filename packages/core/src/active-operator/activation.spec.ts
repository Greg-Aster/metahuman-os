import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import test, { mock } from 'node:test'
import { selectActivatedOperations, type ActivationUpdate } from './activation.js'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-'))
process.env.METAHUMAN_ROOT = root
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { robotAutonomyControllerParserNode: parser, parseRobotAutonomyChoice } = await import('../nodes/robot-operator/autonomy-controller-parser.node.js')
const update = (operationId: string, activation: number): ActivationUpdate => ({operationId, activation, reason: 'Recorded context', instruction: 'Full unchanged intention'})
const operations = [{id:'reflector'}, {id:'daydreamer'}, {id:'boredom-observer'}]
const levels = [update('reflector', 99.9), update('daydreamer',100), update('boredom-observer',100)]
test('mode rules cover Semi boundary, all qualifying operations, Full ties, empty choices and Reactive', () => {
  assert.deepEqual(selectActivatedOperations(levels,'semi'),levels.slice(1))
  assert.deepEqual(selectActivatedOperations(levels,'full'),[levels[1]])
  assert.deepEqual(selectActivatedOperations([update('reflector',0),update('daydreamer',0)],'full'),[update('reflector',0)])
  assert.deepEqual(selectActivatedOperations([update('reflector',24),update('daydreamer',41)],'full'),[update('daydreamer',41)])
  assert.deepEqual(selectActivatedOperations(levels,'reactive'),[])
  assert.deepEqual(selectActivatedOperations([],'full'),[])
})
test('two assessments preserve omitted levels but request only this assessment updates', async () => {
  const first = await parser.execute({ response: JSON.stringify({updates:levels}), availableTasks:operations,
    activationState:{mode:'semi',previous:null,assessedAt:'2026-10-15T12:00:00Z'} },{graphExecution:{executionId:'first'} as any},{})
  const second = await parser.execute({ response:JSON.stringify({updates:[update('reflector',55)]}), availableTasks:operations,
    activationState:{mode:'full',previous:first.assessment,assessedAt:'2026-10-15T12:01:00Z'} },{graphExecution:{executionId:'second'} as any},{})
  assert.equal(second.assessment.levels.daydreamer.activation,100)
  assert.equal(second.assessment.levels.daydreamer.assessedAt,first.assessment.assessedAt)
  assert.deepEqual(second.assessment.selected,[update('reflector',55)])
  assert.throws(()=>parseRobotAutonomyChoice(JSON.stringify({updates:[update('unknown',100)]}),operations))
  assert.throws(()=>parseRobotAutonomyChoice(JSON.stringify({updates:[update('reflector',101)]}),operations))
})
test('assessment survives process reopening and unrelated queue-history eviction', async () => {
  const { ExecutionStore } = await import('../durable-execution/store.js')
  const { ExecutionCheckpointer } = await import('../durable-execution/checkpointer.js')
  const filename = path.join(root,'execution.sqlite')
  const store = new ExecutionStore(filename)
  const definition={graphId:'operator',graphHash:'fixture',runtimeVersion:'fixture',checkpointSchemaVersion:1,nodeVersions:{active_operator_dispatch:'1'}}
  const record=store.enter('fixture',definition,'assessment', {graph:{name:'Active Operator'},context:{username:'fixture',
    robotOperatorContext:{robotObserver:{requestedBy:'robot-autonomy-controller'}}}})
  const lease=store.claim(record.executionId,definition)
  const assessment={executionId:record.executionId,mode:'semi',assessedAt:'2026-10-15T12:00:00Z',updates:levels,
    levels:{reflector:{...levels[0],assessedAt:'2026-10-15T12:00:00Z'}},selected:levels.slice(1)}
  await new ExecutionCheckpointer(store,lease).put({configurable:{thread_id:record.executionId}}, {
    v:4,id:randomUUID(),ts:new Date().toISOString(),channel_versions:{},versions_seen:{},channel_values:{nodeEntries:[['editable-id',{
      status:'completed',definition:{type:'robot_autonomy_controller_parser'},outputs:{assessment}}]]}}, {source:'loop',step:0,parents:{}})
  store.settle(lease,'completed');store.release(lease);store.close()
  const storage=await import('../durable-execution/storage.js')
  const mocked=mock.module('../durable-execution/storage.js',{namedExports:{...storage,openExecutionStore:()=>new ExecutionStore(filename)}})
  try {
    const {readActivationAssessments}=await import('./activation-history.js')
    assert.deepEqual(await readActivationAssessments('fixture',1),[assessment])
  } finally {mocked.restore()}
})
test.after(()=>fs.rmSync(root,{recursive:true,force:true}))

test('Semi admits multiple selected jobs independently; mode changes are applied at dispatch', async () => {
  fs.mkdirSync(path.join(root,'etc'),{recursive:true})
  fs.copyFileSync(new URL('../../../../etc/agents.json',import.meta.url),path.join(root,'etc/agents.json'))
  const {activeOperatorDispatchNode}=await import('../nodes/robot-operator/activation-dispatch.node.js')
  const tasks=operations.map(operation=>({...operation,name:operation.id,kind:'agent',handler:`agent.${operation.id}`,taskType:'generic',priority:'low',tags:[]}))
  const calls:any[]=[]
  const context={username:'fixture',graphExecution:{executionId:'assessment',dispatch:(effect:any)=>{calls.push(effect);return {effectId:`effect-${calls.length}`}}}} as any
  const assessment={executionId:'assessment',assessedAt:'2026-10-15T12:00:00Z',mode:'full',updates:levels,levels:{},selected:[levels[1]]}
  fs.writeFileSync(path.join(root,'etc/active-operator.json'),JSON.stringify({autonomyMode:'semi'}))
  const result=await activeOperatorDispatchNode.execute({assessment,availableTasks:tasks},context,{})
  assert.deepEqual(calls.map(effect=>effect.payload.input.agentId),['daydreamer','boredom-observer'])
  assert.ok(calls.every(effect=>effect.payload.executionScope==='independent'))
  assert.equal(result.innerEntries.length,2)
  assert.ok(result.innerEntries.every((entry:any)=>entry.meta.source==='autonomy'))
  assert.equal(result.requests[0].input.graphContext.taskBrief,JSON.stringify(result.requests[0].input.plannerDecision))
  fs.writeFileSync(path.join(root,'etc/active-operator.json'),JSON.stringify({autonomyMode:'reactive'}))
  const dormant=await activeOperatorDispatchNode.execute({assessment,availableTasks:tasks},context,{})
  assert.equal(dormant.requests.length,0)
  assert.equal(calls.length,2)
})
