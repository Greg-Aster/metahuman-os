import assert from 'node:assert/strict'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import {
  handleGetServerUpdate,
  handlePostServerUpdate,
  type ServerUpdateDependencies,
} from './server-update.js'

const request = {
  method: 'POST',
  path: '/api/server-update',
  user: { id: 'owner', username: 'owner', role: 'owner', isAuthenticated: true },
} as any

function createDependencies(options: {
  dirty?: boolean
  fetchError?: Error
  installError?: Error
  buildError?: Error
  waitForBuild?: () => Promise<void>
  ahead?: number
  behind?: number
} = {}): { dependencies: ServerUpdateDependencies; gitCalls: string[][]; pnpmCalls: string[][] } {
  const gitCalls: string[][] = []
  const pnpmCalls: string[][] = []
  let headReads = 0

  const dependencies: ServerUpdateDependencies = {
    gitDirectoryExists: () => true,
    getPackageVersion: () => '1.0.0',
    runGit: async args => {
      gitCalls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse HEAD') {
        headReads += 1
        return headReads === 1 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb'
      }
      if (key === 'rev-parse --abbrev-ref HEAD') return 'main'
      if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return 'origin/main'
      if (key === 'status --porcelain') return options.dirty ? ' M local-change.ts' : ''
      if (key === 'fetch --quiet') {
        if (options.fetchError) throw options.fetchError
        return ''
      }
      if (key === 'rev-parse origin/main') return 'bbbbbbbbbbbbbbbb'
      if (key === 'rev-list --left-right --count HEAD...origin/main') {
        return `${options.ahead ?? 0}\t${options.behind ?? 2}`
      }
      if (key === 'log --oneline HEAD..origin/main -10') return 'bbbbbbb update one\nccccccc update two'
      if (key === 'pull --ff-only') return 'Fast-forward'
      if (key === 'diff --name-only aaaaaaaaaaaaaaaa..HEAD') return 'packages/core/package.json\npackages/core/src/index.ts'
      throw new Error(`Unexpected git command: ${key}`)
    },
    runPnpm: async args => {
      pnpmCalls.push(args)
      if (args[0] === 'install' && options.installError) throw options.installError
      if (args[0] === 'build') {
        if (options.waitForBuild) await options.waitForBuild()
        if (options.buildError) throw options.buildError
      }
      return ''
    },
  }

  return { dependencies, gitCalls, pnpmCalls }
}

test('server update checks never convert fetch failures into an up-to-date result', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies } = createDependencies({ fetchError: new Error('network unavailable') })
    const response = await handleGetServerUpdate({ ...request, method: 'GET' }, dependencies)
    assert.equal(response.status, 500)
    assert.match(response.error || '', /network unavailable/)
  } finally {
    setAuditEnabled(true)
  }
})

test('server update reports dirty trees without starting an update', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies, pnpmCalls } = createDependencies({ dirty: true })
    const response = await handleGetServerUpdate({ ...request, method: 'GET' }, dependencies)
    assert.equal(response.status, 200)
    assert.equal(response.data.updateAvailable, true)
    assert.equal(response.data.canUpdate, false)
    assert.match(response.data.reason, /Local changes/)
    assert.deepEqual(pnpmCalls, [])
  } finally {
    setAuditEnabled(true)
  }
})

test('server update refuses a diverged branch before fast-forward pull', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies, gitCalls, pnpmCalls } = createDependencies({ ahead: 1, behind: 2 })
    const check = await handleGetServerUpdate({ ...request, method: 'GET' }, dependencies)
    assert.equal(check.status, 200)
    assert.equal(check.data.updateAvailable, true)
    assert.equal(check.data.canUpdate, false)
    assert.match(check.data.reason, /diverged/)

    const update = await handlePostServerUpdate(request, dependencies)
    assert.equal(update.status, 409)
    assert.match(update.error || '', /diverged/)
    assert.equal(gitCalls.some(args => args.join(' ') === 'pull --ff-only'), false)
    assert.deepEqual(pnpmCalls, [])
  } finally {
    setAuditEnabled(true)
  }
})

test('server update installs changed dependencies and builds before reporting success', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies, gitCalls, pnpmCalls } = createDependencies()
    const response = await handlePostServerUpdate(request, dependencies)
    assert.equal(response.status, 200)
    assert.equal(response.data.success, true)
    assert.equal(response.data.restartRequired, true)
    assert.deepEqual(pnpmCalls, [['install'], ['build']])
    assert.equal(gitCalls.some(args => args.join(' ') === 'pull --ff-only'), true)
  } finally {
    setAuditEnabled(true)
  }
})

test('server update reports a post-pull build failure as incomplete', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies } = createDependencies({ buildError: new Error('production build failed') })
    const response = await handlePostServerUpdate(request, dependencies)
    assert.equal(response.status, 500)
    assert.match(response.error || '', /production build failed/)
    assert.equal(response.data.repositoryUpdated, true)
  } finally {
    setAuditEnabled(true)
  }
})

test('server update does not report success when dependency installation fails', async () => {
  setAuditEnabled(false)
  try {
    const { dependencies, pnpmCalls } = createDependencies({ installError: new Error('dependency installation failed') })
    const response = await handlePostServerUpdate(request, dependencies)
    assert.equal(response.status, 500)
    assert.match(response.error || '', /dependency installation failed/)
    assert.equal(response.data.repositoryUpdated, true)
    assert.deepEqual(pnpmCalls, [['install']])
  } finally {
    setAuditEnabled(true)
  }
})

test('server update rejects concurrent repeated invocation', async () => {
  setAuditEnabled(false)
  let releaseBuild!: () => void
  let markBuildStarted!: () => void
  const buildStarted = new Promise<void>(resolve => { markBuildStarted = resolve })
  const buildRelease = new Promise<void>(resolve => { releaseBuild = resolve })

  try {
    const { dependencies } = createDependencies({
      waitForBuild: async () => {
        markBuildStarted()
        await buildRelease
      },
    })
    const first = handlePostServerUpdate(request, dependencies)
    await buildStarted
    const repeated = await handlePostServerUpdate(request, dependencies)
    assert.equal(repeated.status, 409)
    releaseBuild()
    assert.equal((await first).status, 200)
  } finally {
    setAuditEnabled(true)
  }
})
