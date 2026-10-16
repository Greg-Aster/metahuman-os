#!/usr/bin/env node
// One real, owner-requested invocation through the running Site's graph API.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const demoInstruction = 'Look at the robot’s camera image and choose an object you want to investigate. Ask the Robot Autonomy Executor to visually track it while the robot stays stationary. Use the returned tracking evidence to describe what happened.';

export function prepareDemoGraph(savedGraph) {
  const graph = structuredClone(savedGraph);
  const policy = graph.nodes.find(node => node.id === 'policy' && node.data.nodeType === 'text_input');
  if (!policy) throw new Error('The saved autonomy controller has no policy text-input node.');
  policy.data.properties.message += `\n\n${demoInstruction}`;
  return graph;
}

export async function runDemo({ baseUrl, cookie, output }) {
  const headers = { Cookie: cookie.trim(), Origin: new URL(baseUrl).origin };
  const saved = await fetch(new URL('/api/cognitive-graph?name=robot-autonomy-controller-mode', baseUrl), { headers });
  if (!saved.ok) throw new Error(`Loading the saved controller failed: HTTP ${saved.status}`);
  const graph = prepareDemoGraph((await saved.json()).graph);
  const response = await fetch(new URL('/api/execute-graph-stream', baseUrl), {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, userMessage: demoInstruction }),
  });
  if (!response.ok) throw new Error(`Starting the live graph failed: HTTP ${response.status}`);
  const trace = await response.text();
  await writeFile(output, trace, { mode: 0o600 });
  const events = trace.replaceAll('\r\n', '\n').split('\n\n').flatMap(block => {
    const type = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    return type && data ? [{ type, data: JSON.parse(data) }] : [];
  });
  const returned = events.findLast(event => ['graph_complete', 'graph_waiting', 'graph_error', 'error'].includes(event.type));
  if (!returned) throw new Error(`No graph outcome was returned. Inspect ${output} before submitting again.`);
  if (returned.type === 'graph_error' || returned.type === 'error') throw new Error(returned.data.error);
  return { status: returned.data.status, executionId: returned.data.executionId, trace: output };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes('--help')) {
    console.log('Usage: node scripts/smoke-autonomy-vision.mjs --url <MetaHuman URL> --cookie-file <private Cookie header file> --output <private SSE trace path>');
    console.log('Runs the saved autonomy controller once with the approved stationary investigation instruction. Uses current model assignments. A waiting execution continues in the existing Coordinator; do not resubmit it.');
    return;
  }
  const baseUrl = option('--url');
  const cookieFile = option('--cookie-file');
  const output = option('--output');
  if (!baseUrl || !cookieFile || !output) throw new Error('Supply --url, --cookie-file and --output; see --help.');
  const result = await runDemo({ baseUrl, cookie: await readFile(cookieFile, 'utf8'), output });
  console.log(JSON.stringify(result, null, 2));
  console.log('This is the graph invocation status, not proof that the target is tracking. Follow its execution ID in MetaHuman and inspect Body Control tracking evidence.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
