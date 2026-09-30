import assert from 'node:assert/strict'
import test from 'node:test'
import { callRunpodGraphQL, terminateTrainingPod } from './runpod.js'

test('pod transport uses bound variables and fails on GraphQL errors inside HTTP success', async () => {
  const variables = { input: { gpuTypeId: 'A selected GPU', templateId: 'fixture' } }
  let called = false
  const fetcher: typeof fetch = async (url, init) => {
    called = true
    assert.equal(url, 'https://api.runpod.io/graphql')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key')
    assert.deepEqual(JSON.parse(init!.body as string), { query: 'mutation Test', variables })
    assert.ok(init?.signal)
    return Response.json({ data: { pod: { id: 'receipt' } } })
  }
  assert.deepEqual(await callRunpodGraphQL('test-key', 'mutation Test', variables, { fetch: fetcher }), { pod: { id: 'receipt' } })
  assert.equal(called, true)
  for (const response of [Response.json({ errors: [{ message: 'Invalid GPU' }] }), Response.json({}), new Response('', { status: 503 })]) {
    await assert.rejects(callRunpodGraphQL('key', 'query', {}, { fetch: async () => response }))
  }
  await assert.rejects(callRunpodGraphQL('', 'query', {}, { fetch: fetcher }), /API key/)
})

test('termination requires provider-confirmed absence and never retries allocation', async () => {
  const pod = { id: 'owned-id', name: 'metahuman-training-fixture' }
  const responses = [{ pod }, { podTerminate: null }, { pod }, { pod: null }]
  const queries: string[] = []
  const result = await terminateTrainingPod('key', { podId: pod.id, podName: pod.name }, {
    pollIntervalMs: 1, attempts: 2, fetch: async (_url, init) => {
      queries.push(JSON.parse(init!.body as string).query)
      return Response.json({ data: responses.shift() })
    },
  })
  assert.equal(result.podId, pod.id)
  assert.ok(Number.isFinite(Date.parse(result.confirmedAt)))
  assert.equal(queries.filter(query => query.includes('mutation')).length, 1)
  assert.equal(responses.length, 0)
})

test('ambiguous creation recovers only the exact named pod and rejects nonunique identities', async () => {
  const pod = { id: 'recovered', name: 'metahuman-training-fixture' }
  const responses = [{ myself: { pods: [{ id: 'other', name: 'unrelated' }, pod] } }, { pod }, { podTerminate: null }, { pod: null }]
  const result = await terminateTrainingPod('key', { podId: null, podName: pod.name }, {
    pollIntervalMs: 1, fetch: async () => Response.json({ data: responses.shift() }),
  })
  assert.equal(result.podId, pod.id)
  await assert.rejects(terminateTrainingPod('key', { podId: null, podName: pod.name }, {
    fetch: async () => Response.json({ data: { myself: { pods: [pod, pod] } } }),
  }), /More than one/)
})

test('a successful mutation cannot conceal a remaining pod or a mismatched receipt', async () => {
  const pod = { id: 'owned', name: 'metahuman-training-fixture' }
  await assert.rejects(terminateTrainingPod('key', { podId: pod.id, podName: pod.name }, {
    attempts: 2, pollIntervalMs: 1, fetch: async (_url, init) => Response.json({ data:
      JSON.parse(init!.body as string).query.includes('mutation') ? { podTerminate: null } : { pod } }),
  }), /remains unconfirmed/)
  await assert.rejects(terminateTrainingPod('key', { podId: pod.id, podName: pod.name }, {
    fetch: async () => Response.json({ data: { pod: { ...pod, name: 'another-job' } } }),
  }), /identity differs/)
  await assert.rejects(terminateTrainingPod('key', { podId: pod.id, podName: pod.name }, { fetch: async () => Response.json({ data: {} }) }), /no pod status/)
})
