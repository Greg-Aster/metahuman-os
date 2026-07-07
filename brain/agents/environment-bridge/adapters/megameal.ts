import {
  audit,
  claimEnvironmentActions,
  claimEnvironmentTextEvents,
  cognitiveGraphPath,
  collectNodeOutputs,
  loadGraphFile,
  publishEnvironmentObservation,
  recordEnvironmentActionResult,
  type EnvironmentAction,
  type EnvironmentConnectionConfig,
  type EnvironmentFeedback,
  type EnvironmentLocationData,
  type EnvironmentObservation,
} from '@metahuman/core';
import WebSocket from 'ws';

const MEGAMEAL_RELAY_PATH = '/__megameal-dev-bridge';
const RECONNECT_DELAY_MS = 1500;
const ACTION_CLAIM_LIMIT = 20;
const TOUCH_IDS = {
  forward: 'mobile.move.forward',
  back: 'mobile.move.back',
  left: 'mobile.move.left',
  right: 'mobile.move.right',
  jump: 'mobile.jump',
  interact: 'mobile.interact.primary',
} as const;

type BridgeRuntime = {
  stop(): Promise<void>;
  ready: Promise<void>;
};

type MegamealBridgeMessage =
  | { type: 'bridge:ready'; role?: string; sessionId?: string; gameSessions?: string[] }
  | { type: 'game:snapshot'; snapshot?: MegamealSnapshot }
  | { type: 'game:command-result'; result?: MegamealCommandResult }
  | { type: 'game:log'; entry?: { id?: string; timestamp?: number; level?: string; message?: string } }
  | { type: 'bridge:error'; message?: string };

type MegamealSnapshot = {
  sessionId?: string;
  timestamp?: number;
  activeRuntimeSceneId?: string;
  loadingRuntimeSceneId?: string;
  runtime?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  multiplayer?: {
    enabled?: boolean;
    mode?: string;
    status?: string;
    localPeerId?: string;
    roomName?: string;
    connectedPeers?: string[];
    remotePlayers?: Array<Record<string, unknown>>;
    chatMessages?: MegamealChatMessage[];
    logs?: Array<Record<string, unknown>>;
    error?: string;
  };
  diagnostics?: Record<string, unknown>;
};

type MegamealChatMessage = {
  id?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  timestamp?: string;
};

type MegamealCommand = {
  id: string;
  issuedAt: number;
  targetSessionId?: string;
} & (
  | { type: 'sendChat'; text: string }
  | { type: 'setTouchActionValue'; touchId: string; value: number; durationMs?: number }
  | { type: 'clearTouchControls' }
);

type MegamealCommandResult = {
  commandId?: string;
  sessionId?: string;
  timestamp?: number;
  commandType?: string;
  accepted?: boolean;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relayUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.pathname = MEGAMEAL_RELAY_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function graphFileName(graphName: string | undefined): string {
  const name = graphName?.trim() || 'environment-mode';
  return name.endsWith('.json') ? name : `${name}.json`;
}

function isoFromMs(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function textStartsWithYou(text: string): boolean {
  return /^\s*you\b[\s:,-]*/i.test(text);
}

function isSelfChatMessage(message: MegamealChatMessage, localPeerId?: string): boolean {
  const senderId = message.senderId?.trim();
  const senderName = message.senderName?.trim();
  const text = message.text?.trim() ?? '';
  return (
    Boolean(localPeerId && senderId && senderId === localPeerId) ||
    senderName?.toLowerCase() === 'you' ||
    textStartsWithYou(text)
  );
}

function cleanChatText(text: string): string {
  return text.replace(/^\s*(?!you\b)([^\s:]{1,80})\s*:\s*/i, '').trim();
}

function locationFromGameState(snapshot: MegamealSnapshot): EnvironmentLocationData | undefined {
  const state = snapshot.gameState;
  const position = Array.isArray(state?.playerPosition) ? state.playerPosition : undefined;
  const x = typeof position?.[0] === 'number' ? position[0] : undefined;
  const y = typeof position?.[1] === 'number' ? position[1] : undefined;
  const z = typeof position?.[2] === 'number' ? position[2] : undefined;

  if (x === undefined && y === undefined && z === undefined && !snapshot.activeRuntimeSceneId) {
    return undefined;
  }

  return {
    position: {
      x,
      y,
      z,
      level: snapshot.activeRuntimeSceneId,
      coordinateSystem: 'megameal-runtime',
    },
    label: snapshot.activeRuntimeSceneId,
  };
}

function observationFromSnapshot(connection: EnvironmentConnectionConfig, snapshot: MegamealSnapshot): EnvironmentObservation | null {
  const sessionId = snapshot.sessionId?.trim();
  if (!sessionId) {
    return null;
  }

  const multiplayer = snapshot.multiplayer;
  const localPeerId = multiplayer?.localPeerId;
  const text = (multiplayer?.chatMessages ?? [])
    .filter(message => !isSelfChatMessage(message, localPeerId))
    .map(message => {
      const rawText = message.text?.trim() ?? '';
      const cleaned = cleanChatText(rawText);
      if (!cleaned) return null;
      return {
        id: message.id ?? `${message.senderId ?? 'unknown'}:${message.timestamp ?? snapshot.timestamp ?? Date.now()}:${cleaned}`,
        source: 'player' as const,
        text: cleaned,
        timestamp: message.timestamp ?? isoFromMs(snapshot.timestamp),
        senderId: message.senderId,
        senderName: message.senderName ?? message.senderId,
        channel: multiplayer?.roomName,
      };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);

  const state = {
    gameState: snapshot.gameState ?? {},
    runtime: snapshot.runtime ?? {},
    multiplayer: {
      enabled: multiplayer?.enabled,
      mode: multiplayer?.mode,
      status: multiplayer?.status,
      roomName: multiplayer?.roomName,
      localPeerId,
      connectedPeers: multiplayer?.connectedPeers ?? [],
      remotePlayers: multiplayer?.remotePlayers ?? [],
      error: multiplayer?.error,
    },
    activeRuntimeSceneId: snapshot.activeRuntimeSceneId,
    loadingRuntimeSceneId: snapshot.loadingRuntimeSceneId,
    diagnostics: snapshot.diagnostics ?? {},
  };

  return {
    environmentId: connection.id,
    adapter: 'megameal',
    sessionId,
    timestamp: isoFromMs(snapshot.timestamp),
    capabilities: {
      actions: ['move', 'jump', 'interact', 'stop', 'sendText'],
      text: true,
      movement: true,
      visual: false,
      map: false,
    },
    text,
    state,
    location: locationFromGameState(snapshot),
  };
}

function feedbackFromResult(result: MegamealCommandResult): EnvironmentFeedback | null {
  if (!result.commandId) {
    return null;
  }

  return {
    id: `megameal-feedback-${result.commandId}`,
    timestamp: isoFromMs(result.timestamp),
    actionId: result.commandId,
    type: result.accepted === false ? 'rejected' : 'completed',
    message: result.message ?? `${result.commandType ?? 'command'} completed`,
    data: { result: result as Record<string, unknown> },
  };
}

function commandId(action: EnvironmentAction): string {
  return action.id || `env-action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function commandForAction(action: EnvironmentAction, targetSessionId: string): MegamealCommand[] {
  const base = {
    id: commandId(action),
    issuedAt: Date.now(),
    targetSessionId,
  };

  if (action.type === 'sendText') {
    const text = action.text?.trim();
    return text ? [{ ...base, type: 'sendChat', text }] : [];
  }

  if (action.type === 'stop') {
    return [{ ...base, type: 'clearTouchControls' }];
  }

  if (action.type === 'jump') {
    return [{
      ...base,
      type: 'setTouchActionValue',
      touchId: TOUCH_IDS.jump,
      value: 1,
      durationMs: Math.max(100, Math.min(1000, action.durationMs ?? 250)),
    }];
  }

  if (action.type === 'interact') {
    return [{
      ...base,
      type: 'setTouchActionValue',
      touchId: TOUCH_IDS.interact,
      value: 1,
      durationMs: Math.max(100, Math.min(1500, action.durationMs ?? 300)),
    }];
  }

  if (action.type === 'move') {
    const direction = action.direction ?? 'forward';
    const touchId = direction === 'back'
      ? TOUCH_IDS.back
      : direction === 'left'
        ? TOUCH_IDS.left
        : direction === 'right'
          ? TOUCH_IDS.right
          : TOUCH_IDS.forward;

    return [{
      ...base,
      type: 'setTouchActionValue',
      touchId,
      value: Math.max(0, Math.min(1, action.amount ?? 1)),
      durationMs: Math.max(100, Math.min(5000, action.durationMs ?? 750)),
    }];
  }

  return [];
}

async function runEnvironmentGraph(options: {
  connection: EnvironmentConnectionConfig;
  observation: EnvironmentObservation;
  userMessage: string;
  username?: string;
}): Promise<void> {
  const loaded = await loadGraphFile(cognitiveGraphPath(graphFileName(options.connection.graphName)), {
    logPrefix: '[environment-bridge]',
  });
  if (!loaded) {
    throw new Error(`Environment graph not found: ${options.connection.graphName ?? 'environment-mode'}`);
  }

  const graphState = await import('@metahuman/core').then(({ runGraph }) => runGraph({
    graph: loaded.graph,
    context: {
      sessionId: options.observation.sessionId,
      userMessage: options.userMessage,
      userId: options.username,
      username: options.username,
      cognitiveMode: 'environment',
      environment: 'server',
      environmentObservation: options.observation,
    },
  }));

  const outputs = collectNodeOutputs(graphState);
  const actionParserOutput = outputs['6'];
  if (actionParserOutput && Array.isArray(actionParserOutput.actions)) {
    const actionSummary = actionParserOutput.actions.map((action: EnvironmentAction) => {
      if (action.type === 'move') {
        return `${action.type}:${action.direction ?? 'forward'}:${action.durationMs ?? 0}ms`;
      }
      return action.type;
    });
    console.log(`[environment-bridge] graph actions: ${actionSummary.join(', ') || 'none'}`);
  }
  audit({
    level: 'info',
    category: 'system',
    event: 'environment_bridge_graph_ran',
    details: {
      graphName: options.connection.graphName ?? 'environment-mode',
      sessionId: options.observation.sessionId,
      outputNodes: Object.keys(outputs).length,
    },
    actor: options.username,
  });
}

export function startMegamealBridgeAdapter(options: {
  connection: EnvironmentConnectionConfig;
  username?: string;
  signal?: AbortSignal;
}): BridgeRuntime {
  let socket: WebSocket | undefined;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let busy = Promise.resolve();
  let readyResolve: () => void = () => {};
  let readyReject: (error: Error) => void = () => {};
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const settleReady = (error?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (error) readyReject(error);
    else readyResolve();
  };

  const send = (message: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const dispatchQueuedActions = (sessionId: string) => {
    const actions = claimEnvironmentActions(sessionId, ACTION_CLAIM_LIMIT);
    if (actions.length > 0) {
      console.log(
        `[environment-bridge] dispatching ${actions.length} action(s) to Megameal: ${actions.map(action => action.type).join(', ')}`,
      );
    }
    for (const action of actions) {
      for (const command of commandForAction(action, sessionId)) {
        console.log(`[environment-bridge] Megameal command ${command.type}${command.type === 'setTouchActionValue' ? ` ${command.touchId}=${command.value} ${command.durationMs ?? 0}ms` : ''}`);
        send({ type: 'controller:command', command });
      }
    }
  };

  const handleSnapshot = async (snapshot: MegamealSnapshot) => {
    const observation = observationFromSnapshot(options.connection, snapshot);
    if (!observation) {
      return;
    }

    publishEnvironmentObservation(observation);
    const textEvents = claimEnvironmentTextEvents(observation);
    if (textEvents.length > 0) {
      const currentObservation = {
        ...observation,
        text: textEvents,
      };
      const userMessage = textEvents.map(event => event.text).join('\n');
      await runEnvironmentGraph({
        connection: options.connection,
        observation: currentObservation,
        userMessage,
        username: options.username,
      });
    }
    dispatchQueuedActions(observation.sessionId);
  };

  const handleMessage = (message: MegamealBridgeMessage) => {
    if (message.type === 'bridge:ready') {
      settleReady();
      console.log(`[environment-bridge] connected to Megameal relay (${options.connection.url})`);
      return;
    }

    if (message.type === 'bridge:error') {
      console.error(`[environment-bridge] Megameal relay error: ${message.message ?? 'unknown error'}`);
      return;
    }

    if (message.type === 'game:snapshot' && isRecord(message.snapshot)) {
      busy = busy.then(() => handleSnapshot(message.snapshot as MegamealSnapshot)).catch(error => {
        console.error('[environment-bridge] Snapshot handling failed:', error);
      });
      return;
    }

    if (message.type === 'game:command-result' && isRecord(message.result)) {
      const feedback = feedbackFromResult(message.result as MegamealCommandResult);
      if (feedback) {
        recordEnvironmentActionResult(feedback);
      }
    }
  };

  const connect = () => {
    if (stopped) {
      return;
    }

    let url: string;
    try {
      url = relayUrl(options.connection.url);
    } catch (error) {
      settleReady(error as Error);
      return;
    }

    socket = new WebSocket(url);
    socket.on('open', () => {
      send({ type: 'bridge:hello', role: 'controller' });
    });
    socket.on('message', data => {
      try {
        const parsed = JSON.parse(data.toString()) as MegamealBridgeMessage;
        handleMessage(parsed);
      } catch (error) {
        console.error('[environment-bridge] Invalid Megameal bridge message:', error);
      }
    });
    socket.on('error', error => {
      if (!readySettled) {
        settleReady(error);
      }
      console.error(`[environment-bridge] Megameal socket error: ${error.message}`);
    });
    socket.on('close', () => {
      if (stopped) {
        return;
      }
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  };

  options.signal?.addEventListener('abort', () => {
    void stop();
  }, { once: true });

  const stop = async () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    socket?.close();
    await busy;
  };

  connect();

  return {
    ready,
    stop,
  };
}
