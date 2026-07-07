export type EnvironmentActionType =
  | 'move'
  | 'look'
  | 'jump'
  | 'interact'
  | 'stop'
  | 'sendText';

export interface EnvironmentCapabilities {
  actions: EnvironmentActionType[];
  text?: boolean;
  movement?: boolean;
  visual?: boolean;
  map?: boolean;
}

export interface EnvironmentTextEvent {
  id: string;
  source: 'player' | 'npc' | 'system' | 'environment';
  text: string;
  timestamp: string;
  senderId?: string;
  senderName?: string;
  channel?: string;
}

export interface EnvironmentVisualFrame {
  id: string;
  timestamp: string;
  mimeType?: string;
  url?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  altText?: string;
  source?: string;
  camera?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentCoordinate {
  x?: number;
  y?: number;
  z?: number;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  heading?: number;
  level?: string;
  coordinateSystem?: string;
}

export interface EnvironmentLocationData {
  position?: EnvironmentCoordinate;
  heading?: number;
  areaId?: string;
  roomId?: string;
  label?: string;
  description?: string;
  data?: Record<string, unknown>;
}

export interface EnvironmentMapLandmark {
  id?: string;
  label?: string;
  type?: string;
  position?: EnvironmentCoordinate;
  description?: string;
  data?: Record<string, unknown>;
}

export interface EnvironmentMapRegion {
  id?: string;
  label?: string;
  type?: string;
  bounds?: Record<string, unknown>;
  description?: string;
  data?: Record<string, unknown>;
}

export interface EnvironmentMapPath {
  id?: string;
  label?: string;
  type?: string;
  from?: string;
  to?: string;
  points?: EnvironmentCoordinate[];
  description?: string;
  data?: Record<string, unknown>;
}

export interface EnvironmentMapData {
  id?: string;
  label?: string;
  timestamp?: string;
  coordinateSystem?: string;
  origin?: EnvironmentCoordinate | Record<string, unknown>;
  bounds?: Record<string, unknown>;
  landmarks?: EnvironmentMapLandmark[];
  regions?: EnvironmentMapRegion[];
  paths?: EnvironmentMapPath[];
  notes?: string | string[];
  data?: Record<string, unknown>;
}

export interface EnvironmentFeedback {
  id: string;
  timestamp: string;
  type: 'accepted' | 'rejected' | 'completed' | 'failed' | 'status';
  message: string;
  actionId?: string;
  data?: Record<string, unknown>;
}

export interface EnvironmentObservation {
  environmentId: string;
  adapter: string;
  sessionId: string;
  timestamp: string;
  capabilities: EnvironmentCapabilities;
  text?: EnvironmentTextEvent[];
  state?: Record<string, unknown>;
  location?: EnvironmentLocationData;
  map?: EnvironmentMapData;
  visual?: EnvironmentVisualFrame;
  visuals?: EnvironmentVisualFrame[];
  feedback?: EnvironmentFeedback[];
}

export interface EnvironmentConnectionConfig {
  id: string;
  adapter: string;
  enabled: boolean;
  url: string;
  hostName?: string;
  roomName?: string;
  graphName?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentAction {
  id: string;
  sessionId?: string;
  type: EnvironmentActionType;
  createdAt: string;
  text?: string;
  vector?: { x?: number; y?: number; z?: number };
  direction?: 'forward' | 'back' | 'left' | 'right';
  amount?: number;
  durationMs?: number;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface QueuedEnvironmentAction extends EnvironmentAction {
  status: 'queued' | 'dispatched' | 'completed' | 'failed' | 'rejected';
  dispatchedAt?: string;
  completedAt?: string;
  result?: EnvironmentFeedback;
}

export interface EnvironmentActionQueueOptions {
  allowedActions?: EnvironmentActionType[];
  maxDurationMs?: number;
  defaultDurationMs?: number;
}

export interface EnvironmentSessionState {
  sessionId: string;
  environmentId: string;
  adapter: string;
  status: 'connected' | 'stale' | 'disconnected';
  firstSeenAt: string;
  lastSeenAt: string;
  latestObservation?: EnvironmentObservation;
  processedTextEventIds?: string[];
}

export interface EnvironmentBridgeState {
  enabled: boolean;
  updatedAt: string;
  connections: Record<string, EnvironmentConnectionConfig>;
  sessions: Record<string, EnvironmentSessionState>;
  queuedActions: QueuedEnvironmentAction[];
  feedback: EnvironmentFeedback[];
}

export interface EnvironmentBridgeSummary {
  enabled: boolean;
  updatedAt: string;
  sessionCount: number;
  queuedActionCount: number;
  sessions: EnvironmentSessionState[];
}
