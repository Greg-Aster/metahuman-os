import path from 'node:path';
import { AGENT_CATALOG_DEFINITIONS } from '@metahuman/core/agent-catalog-definitions';
import { resolveAgentExecutablePath } from '@metahuman/core/agent-executable-resolver';

/** Server and delegated processes share one Rollup module graph and executable version. */
export function compiledAgents(repoRoot) {
  let serverBuild = false;
  let executables;
  return {
    name: 'metahuman-compiled-agents',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { serverBuild = Boolean(config.build.ssr); },
    buildStart() {
      if (!serverBuild) return;
      const entries = new Map();
      const emit = (source, name) => {
        if (!entries.has(source)) entries.set(source, this.emitFile({
          type: 'chunk', id: source, fileName: `agents/${name}.mjs`,
          preserveSignature: 'strict',
        }));
        return `import.meta.ROLLUP_FILE_URL_${entries.get(source)}`;
      };
      const urls = new Map();
      urls.set('$bootstrap', emit(path.join(repoRoot, 'packages/core/src/agent-bootstrap.ts'), 'bootstrap'));
      for (const [id, definition] of Object.entries(AGENT_CATALOG_DEFINITIONS)) {
        const source = resolveAgentExecutablePath(id);
        if (!source) continue;
        const url = emit(source, id);
        urls.set(id, url);
        if (definition.sourceId) urls.set(definition.sourceId, url);
      }
      executables = `{${[...urls].map(([id, url]) => `${JSON.stringify(id)}:${url}`).join(',')}}`;
    },
    transform(code, id) {
      if (!serverBuild || id !== path.join(repoRoot, 'packages/core/src/agent-executable-resolver.ts')) return;
      return { code: code.replaceAll('__METAHUMAN_AGENT_EXECUTABLES__', executables), map: null };
    },
  };
}
