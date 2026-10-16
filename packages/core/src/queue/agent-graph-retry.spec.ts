import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-agent-graph-retry-'))
process.env.METAHUMAN_ROOT = root
const core = path.resolve(import.meta.dirname, '..')
const fixture = path.join(root, 'agent.mts')
const resolver = await import('../agent-executable-resolver.js')
mock.module('../agent-executable-resolver.js', { namedExports: { ...resolver,
  resolveAgentExecutablePath: () => fixture,
  resolveAgentRunner: () => path.resolve(core, '../../../node_modules/.bin/tsx'),
} })
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const { createUser } = await import('../users.js')
const { getProfilePaths } = await import('../path-builder.js')
const { getQueueManager } = await import('./unified-queue-manager.js')
const { TriggerManager } = await import('./trigger-manager.js')
const { ExecutionEngine } = await import('./execution-engine.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { scanEpisodicMemoryRecords } = await import('../memory.js')
const username = 'graph-retry-fixture'
createUser(username, 'fixture-only-password', 'owner')
const profile = getProfilePaths(username)
fs.mkdirSync(profile.etc, { recursive: true })
fs.copyFileSync(path.resolve(core, '../../../etc/chat-settings.json'), path.join(profile.etc, 'chat-settings.json'))
const manager = getQueueManager()
const engine = new ExecutionEngine({}, manager)
fs.writeFileSync(fixture, `
import fs from 'node:fs';
import { runGraph } from '${core}/graph-runtime.ts';
import { withUserContext } from '${core}/context.ts';
import { nodeExecutors } from '${core}/nodes/index.ts';
import { DEFAULT_GRAPH_SCHEDULER } from '${core}/cognitive-graph-schema.ts';
import { setAuditEnabled } from '${core}/audit.ts';
setAuditEnabled(false);
globalThis.fetch = async () => new Response(JSON.stringify({task:{id:'fixture-index'}}),{status:200});
const root=process.env.METAHUMAN_ROOT;
nodeExecutors.set('user_input',async()=>{
 const file=root+'/generations';const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;
 fs.writeFileSync(file,String(count));return {message:'Generated dream '+count};
});
nodeExecutors.set('inner_dialogue_buffer',async()=>{
 const file=root+'/downstream-attempts';const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8'))+1:1;
 fs.writeFileSync(file,String(count));if(count===1)throw new Error('Fixture downstream delivery failed');return {saved:true};
});
const graph={name:'Dream subprocess retry',version:'1.0',format:'svelte-flow',cognitiveMode:'agent',scheduler:DEFAULT_GRAPH_SCHEDULER,
 nodes:[['generate','user_input'],['save','dreamer_dream_saver'],['deliver','inner_dialogue_buffer']].map(([id,nodeType])=>({id,type:'default',position:{x:0,y:0},data:{nodeType,label:id,properties:{}}})),
 edges:[{id:'a',source:'generate',sourceHandle:'message',target:'save',targetHandle:'dreamData'},
 {id:'b',source:'save',sourceHandle:'bufferEntries',target:'deliver',targetHandle:'entries'}]};
await withUserContext({userId:'${username}',username:'${username}',role:'owner'},async()=>{
 const result=await runGraph({graph,context:{userId:'${username}',username:'${username}',allowMemoryWrites:true,cognitiveMode:'agent',
 idempotencyKey:'dreamer:${username}:'+process.env.MH_TASK_ID,memoryTimestamp:process.env.MH_TASK_CREATED_AT}});
 fs.writeFileSync(root+'/last-result.json',JSON.stringify({status:result.status,executionId:result.executionId}));
 process.exitCode=result.status==='completed'?0:1;
});
process.disconnect();
`)
after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

test('Coordinator subprocess retry resumes the committed dream instead of regenerating it', async () => {
  fs.mkdirSync(profile.persona, { recursive: true })
  const modeFile = path.join(profile.persona, 'cognitive-mode.json')
  fs.writeFileSync(modeFile, JSON.stringify({ currentMode: 'environment' }))
  const triggers = new TriggerManager(manager, { version: '1.0.0', revision: 1,
    globalSettings: { pauseAll: false, timezone: 'UTC', quietHours: { enabled: false, start: '22:00', end: '08:00' } },
    agents: { dreamer: { id: 'dreamer', enabled: true, type: 'manual', lifecycle: 'scheduled-work',
      handler: 'agent.dreamer', priority: 'low', allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip', maxRetries: 1 } } })
  const taskId = triggers.triggerManual('dreamer', username)
  assert.ok(taskId)
  const work = manager.getTask(taskId)!
  assert.equal(work.originatingCognitiveMode, 'environment')
  fs.writeFileSync(modeFile, JSON.stringify({ currentMode: 'dual' }))
  assert.ok(manager.claim(work.id))
  const run = () => (engine as any).runAgent(work, 'dreamer', new AbortController().signal)
  await assert.rejects(run(), (error: Error) => { assert.ok(fs.existsSync(path.join(root, 'last-result.json')), error.message); return /exited with code 1/.test(error.message) })
  const first = JSON.parse(fs.readFileSync(path.join(root, 'last-result.json'), 'utf8'))
  assert.equal(first.status, 'failed')
  assert.deepEqual(manager.getTask(work.id)?.graphExecutions, [first.executionId])
  const store = openExecutionStore(username)
  assert.equal(store.get(first.executionId).status, 'waiting')
  assert.equal(manager.requeue(work, { code: 'fixture', message: 'retry', retryable: true }), true)
  assert.ok(manager.claim(work.id))
  await run()
  const second = JSON.parse(fs.readFileSync(path.join(root, 'last-result.json'), 'utf8'))
  assert.equal(second.status, 'completed')
  assert.equal(second.executionId, first.executionId)
  assert.equal(fs.readFileSync(path.join(root, 'generations'), 'utf8'), '1')
  assert.equal(fs.readFileSync(path.join(root, 'downstream-attempts'), 'utf8'), '2')
  assert.equal(store.get(first.executionId).status, 'completed')
  assert.deepEqual(manager.getTask(work.id)?.graphExecutions, [first.executionId])
  assert.equal(manager.getTask(work.id)?.activeGraphExecutionId, undefined)
  const dreams = [...scanEpisodicMemoryRecords(username)].filter(result => result.status === 'record' && result.record.event.type === 'dream')
  assert.equal(dreams.length, 1)
  assert.equal(dreams[0]?.status === 'record' && dreams[0].record.event.metadata?.cognitiveMode, 'environment')
  assert.equal(store.entry(first.executionId).context.cognitiveMode, 'agent')
  assert.equal(store.entry(first.executionId).context.originatingCognitiveMode, 'environment')
  assert.equal(dreams[0]?.status === 'record' && dreams[0].record.event.content, 'Generated dream 1')
  await run() // Lost process acknowledgement reuses the completed checkpoint too.
  assert.equal(fs.readFileSync(path.join(root, 'generations'), 'utf8'), '1')
  assert.equal(fs.readFileSync(path.join(root, 'downstream-attempts'), 'utf8'), '2')
  manager.complete(work.id, true, {})
  store.close()
})

test('subprocess execution retains exhausted attempts as terminal rather than regenerating', async () => {
  fs.writeFileSync(path.join(root, 'downstream-attempts'), '0')
  const work = manager.enqueue({ type: 'dream', handler: 'agent.dreamer', resource: 'local-llm',
    source: 'system', priority: 'background', username, maxAttempts: 1, input: {} })
  assert.ok(manager.claim(work.id))
  const run = () => (engine as any).runAgent(work, 'dreamer', new AbortController().signal)
  await assert.rejects(run(), /exited with code 1/)
  const result = JSON.parse(fs.readFileSync(path.join(root, 'last-result.json'), 'utf8'))
  const store = openExecutionStore(username)
  assert.equal(store.get(result.executionId).status, 'failed')
  assert.equal(store.entry(result.executionId).context.originatingCognitiveMode, undefined)
  const legacyDreams = [...scanEpisodicMemoryRecords(username)].filter(result => result.status === 'record' && result.record.event.content === 'Generated dream 2')
  assert.equal(legacyDreams.length, 1)
  assert.equal(legacyDreams[0]?.status === 'record' && legacyDreams[0].record.event.metadata?.cognitiveMode, undefined)
  const generations = fs.readFileSync(path.join(root, 'generations'), 'utf8')
  await assert.rejects(run(), /terminal failure/)
  assert.equal(fs.readFileSync(path.join(root, 'generations'), 'utf8'), generations)
  store.close()
})
