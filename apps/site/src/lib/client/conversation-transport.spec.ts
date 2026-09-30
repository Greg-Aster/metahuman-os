import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  buildResponsePipelineRequestBody,
  parseConversationStreamEvent,
  responsePipelineCardTypeForReply,
} from './conversation-transport.js';

test('response pipeline routing is limited to stateful card interactions', () => {
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'environment',
    questionId: 'curiosity-one',
  }), 'curiosity_response');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'plan_rejected',
  }), 'desire_rejection');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'clarifying_questions',
  }), 'clarifying_questions');

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    dialogueSource: 'agency-system',
    desireId: 'desire-one',
    cardType: 'approval_requested',
  }), 'desire_plan');
});

test('queued chat completion ends tracking even when the graph hands off without an answer', () => {
  // Execute the component's actual handlers; no alternate transport or UI lifecycle.
  const component = readFileSync(new URL('../../components/ChatInterface.svelte', import.meta.url), 'utf8');
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(component)?.[1];
  assert.ok(script);
  const ast = ts.createSourceFile('chat.ts', script, ts.ScriptTarget.ES2022, true);
  let background: ts.FunctionDeclaration | undefined;
  let foreground: ts.BinaryExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'openQueuedBackgroundStream') background = node;
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'chatResponseStream.onmessage') foreground = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(background && foreground);

  for (const path of ['foreground', 'background'] as const) {
    for (const outcome of ['handoff', 'answer', 'error'] as const) {
      const answers: string[] = [];
      const errors: string[] = [];
      const stream = { closed: false, close() { this.closed = true; }, onmessage: (_event: { data: string }) => {} };
      const state: any = {
        loading: path === 'foreground', active: path === 'foreground', restored: 0,
        activeChatTaskId: path === 'foreground' ? 'current-task' : null,
        chatResponseStream: stream, queuedChatStreams: new Map(), reasoningStages: [],
        connectionEstablished: false, connectionFallbackTimer: null, connectionTimer: null,
        clearConnectionTracking() {}, timestamp: () => 'test', requestComposeTarget: 'conversation',
        console: { log() {}, error() {} }, parseConversationStreamEvent,
        apiEventSource: () => stream, pushComposedInput() {},
        pushGeneratedResponse: (response: string) => answers.push(response),
        messagesApi: { pushMessage: (_role: string, message: string) => errors.push(message) },
        restorePassiveChatStreams: () => { state.restored++; },
        thinkingTraceApi: {
          setActive: (active: boolean) => { state.active = active; },
          stop: () => { state.active = false; },
          setStatusLabel() {}, setTrace() {}, appendTrace() {},
        },
      };
      const context = vm.createContext(state);
      const handler = path === 'background' ? background : foreground;
      vm.runInContext(ts.transpileModule(handler.getText(ast), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText, context);
      const send = (type: string, data = {}) => stream.onmessage({ data: JSON.stringify({ type, data }) });
      if (path === 'background') {
        state.openQueuedBackgroundStream('current-task', 'Unchanged user input', 'conversation');
        send('queued_task_started');
      }
      assert.equal(state.loading, true);
      send('progress', { step: 'input_forwarded', message: 'Input delivered to the selected execution' });
      if (outcome === 'answer') send('answer', { response: 'Model-generated answer' });
      else if (outcome === 'error') send('error', { message: 'Delivery failed' });
      else send('queued_task_completed', { taskId: 'current-task' });
      assert.equal(state.loading, false, `${path}: ${outcome}`);
      assert.equal(state.active, false, `${path}: ${outcome}`);
      assert.equal(state.activeChatTaskId, null);
      assert.equal(stream.closed, true);
      assert.equal(state.queuedChatStreams.size, 0);
      assert.equal(state.restored, 1);
      assert.deepEqual(answers, outcome === 'answer' ? ['Model-generated answer'] : []);
      assert.equal(errors.length, outcome === 'error' ? 1 : 0);
    }
  }
});

test('ordinary selected replies and passive Agency notices use the active conversation graph', () => {
  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'dual',
    cardType: 'assistant_message',
  }), null);

  assert.equal(responsePipelineCardTypeForReply({
    cognitiveMode: 'agent',
    dialogueSource: 'agency-system',
    cardType: 'desire_checkin_status',
  }), null);
});

test('response pipeline requests carry the conversation session id', () => {
  assert.deepEqual(
    buildResponsePipelineRequestBody(
      '  answer  ',
      'curiosity_response',
      { questionId: 'curiosity-one' },
      'conversation-one',
      'buffer-one',
    ),
    {
      message: 'answer',
      cardType: 'curiosity_response',
      cardData: { questionId: 'curiosity-one' },
      sessionId: 'conversation-one',
      responseBufferId: 'buffer-one',
    },
  );
});
