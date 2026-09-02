export type EnvironmentActionType =
  | 'move'
  | 'look'
  | 'jump'
  | 'interact'
  | 'stop'
  | 'captureImage'
  | 'robotCommand'
  | 'robotMotionPlan'
  | 'inspect'
  | 'visualApproach'
  | 'speak'
  | 'sendText';

/**
 * Spatial reference used by an admitted motion objective. These values describe
 * what the adapter can control, not merely which joint or named commands it can
 * execute.
 */
export const ENVIRONMENT_MOTION_CLASSES = [
  'body_local',
  'open_loop_displacement',
  'target_relative',
] as const;

export type EnvironmentMotionClass = typeof ENVIRONMENT_MOTION_CLASSES[number];

/**
 * Monotonic action/camera handoff timestamps contributed by their owning
 * process. Missing stages stay absent rather than being inferred by another
 * owner.
 */
export interface EnvironmentActionTiming {
  version: 1;
  queueEnteredAt?: string;
  leaseGrantedAt?: string;
  bridgeActionSentAt?: string;
  adapterActionReceivedAt?: string;
  captureStartedAt?: string;
  frameReadyAt?: string;
  adapterFeedbackSentAt?: string;
  bridgeFeedbackReceivedAt?: string;
  coreFeedbackReceivedAt?: string;
  bridgeFrameReceivedAt?: string;
  coreObservationReceivedAt?: string;
}

export interface EnvironmentActionStageDurations {
  queueToLeaseMs?: number;
  leaseToBridgeMs?: number;
  bridgeToAdapterMs?: number;
  adapterToCaptureMs?: number;
  captureToFrameMs?: number;
  frameToBridgeMs?: number;
  adapterFeedbackToBridgeMs?: number;
  bridgeToCoreFeedbackMs?: number;
  bridgeFrameToCoreObservationMs?: number;
}

export interface EnvironmentNormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Generic, frame-bound target selected from current visual evidence. */
export interface EnvironmentVisualTargetSpecification {
  version: 1;
  targetId: string;
  frameId: string;
  frameTimestamp: string;
  box: EnvironmentNormalizedBox;
  confidence: number;
  description?: string;
  /** Monocular stop heuristic, not a metric distance estimate. */
  stopBoxHeight?: number;
}

/**
 * Frame-bound request for adapter-owned target acquisition. Cognition names
 * what to inspect; perception owns localization and physical target identity.
 */
export interface EnvironmentVisualInspectionTarget {
  version: 1;
  /** Request identity carried through active-view progress and completion. */
  targetId: string;
  frameId: string;
  frameTimestamp: string;
  query: string;
  /** Optional detector evidence; never required or invented by the LLM. */
  seedBox?: EnvironmentNormalizedBox;
  seedConfidence?: number;
}

export type EnvironmentActiveViewSkill = 'inspect' | 'visualApproach';

export type EnvironmentActiveViewStatus =
  | 'acquiring'
  | 'tracking'
  | 'improving_view'
  | 'reacquiring'
  | 'verifying'
  | 'progress'
  | 'reached'
  | 'lost'
  | 'blocked'
  | 'stuck'
  | 'stopped'
  | 'failed';

export interface EnvironmentActiveViewProgress {
  version: 1;
  skill: EnvironmentActiveViewSkill;
  targetId: string;
  frameId: string;
  timestamp: string;
  status: EnvironmentActiveViewStatus;
  step: number;
  confidence: number;
  progress: number;
  box?: EnvironmentNormalizedBox;
  pathConfidence?: number;
  obstruction?: number;
  reason: string;
}

export type EnvironmentMotionPlanJoint =
  | 'R1'
  | 'R2'
  | 'L1'
  | 'L2'
  | 'R4'
  | 'R3'
  | 'L3'
  | 'L4';

/**
 * The last logical pose established by a correlated completed command.
 * This is commanded-state evidence, not servo feedback or physical proof.
 */
export type EnvironmentCommandedPoseState = {
  version: 1;
  jointMapVersion: 1;
  sourceActionId: string;
  updatedAt: string;
  bodyEpoch?: string;
} & (
  | {
      kind: 'reference';
      reference: 'stand' | 'neutral';
    }
  | {
      kind: 'joints';
      joints: Record<EnvironmentMotionPlanJoint, number>;
    }
);

export interface EnvironmentMotionPlanTarget {
  joint: EnvironmentMotionPlanJoint;
  degrees: number;
}

export interface EnvironmentMotionPlanFrame {
  durationMs: number;
  targets: EnvironmentMotionPlanTarget[];
}

export interface EnvironmentCapabilities {
  actions: EnvironmentActionType[];
  robotCommands?: string[];
  /** Adapter-owned physical meaning for each advertised exact robot command. */
  robotCommandDescriptions?: Record<string, string>;
  /** Motion references the adapter can truthfully execute. */
  motionClasses?: EnvironmentMotionClass[];
  text?: boolean;
  movement?: boolean;
  visual?: boolean;
  map?: boolean;
  /** True only when the adapter provides target-aware path planning and obstacle handling. */
  navigation?: boolean;
  /** Local target tracking and view-improvement loop, when inspect is advertised. */
  activeView?: {
    maxSteps: number;
    maxFrameAgeMs: number;
    minimumConfidence: number;
    reacquisitionLimit: number;
  };
  /** Bounded camera-feedback controller truth, when visualApproach is advertised. */
  visualApproach?: {
    maxSteps: number;
    maxFrameAgeMs: number;
    minimumConfidence: number;
    minimumPathConfidence: number;
    noProgressLimit: number;
  };
}

export interface EnvironmentTextEvent {
  id: string;
  source: 'player' | 'npc' | 'system' | 'environment';
  text: string;
  timestamp: string;
  senderId?: string;
  senderName?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
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
  type: 'accepted' | 'rejected' | 'completed' | 'cancelled' | 'expired' | 'failed' | 'status';
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
  command?: string;
  units?: number;
  amount?: number;
  durationMs?: number;
  target?: string;
  frames?: EnvironmentMotionPlanFrame[];
  endPose?: 'hold' | 'stand' | 'neutral';
  inspectionTarget?: EnvironmentVisualInspectionTarget;
  visualTarget?: EnvironmentVisualTargetSpecification;
  speechArtifactId?: string;
  speechDurationMs?: number;
  timing?: EnvironmentActionTiming;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentCommandWork extends EnvironmentAction {
  status: 'pending' | 'dispatched' | 'accepted' | 'cancelled' | 'expired' | 'failed' | 'rejected';
  dispatchedAt?: string;
  completedAt?: string;
  result?: EnvironmentFeedback;
  correlationId?: string;
}

export interface EnvironmentActionQueueOptions {
  allowedActions?: EnvironmentActionType[];
  maxDurationMs?: number;
  defaultDurationMs?: number;
  sessionId?: string;
  username?: string;
  source?: 'user' | 'system' | 'timer' | 'autonomy' | 'environment';
  correlationId?: string;
  idempotencyKey?: string;
  originatingInstruction?: string;
}

/** Trusted Work Coordinator context for one Environment action. */
export interface EnvironmentActionContext {
  actionId: string;
  status: string;
  requested: {
    type?: EnvironmentActionType;
    command?: string;
    direction?: EnvironmentAction['direction'];
    units?: number;
    target?: string;
  };
  correlationId?: string;
  queuedAt: string;
  completedAt?: string;
  result?: {
    type?: string;
    message?: string;
  };
  taskInstruction?: string;
  robotObserver?: Record<string, unknown>;
  actionTiming?: EnvironmentActionTiming;
}

/** Robot Operator handoff kept separate from the adapter observation. */
export interface RobotOperatorContext {
  robotObserver: Record<string, unknown>;
  plannerDecision?: Record<string, unknown>;
  memories?: string[];
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
  sessions: Record<string, EnvironmentSessionState>;
  feedback: EnvironmentFeedback[];
}

export interface EnvironmentBridgeSummary {
  enabled: boolean;
  updatedAt: string;
  sessionCount: number;
  pendingCommandCount: number;
  sessions: EnvironmentSessionState[];
}
