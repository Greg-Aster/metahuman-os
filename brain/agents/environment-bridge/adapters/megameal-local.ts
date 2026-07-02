import type { EnvironmentAction } from '@metahuman/core';

export const MEGAMEAL_TOUCH_ACTION_IDS = {
  moveForward: 'mobile.move.forward',
  moveBack: 'mobile.move.back',
  moveLeft: 'mobile.move.left',
  moveRight: 'mobile.move.right',
} as const;

export type MegamealLocalCommand =
  | {
      type: 'sendChat';
      text: string;
      targetSessionId?: string;
    }
  | {
      type: 'setTouchActionValue';
      touchId: string;
      value: number;
      durationMs?: number;
      targetSessionId?: string;
    }
  | {
      type: 'clearTouchControls';
      targetSessionId?: string;
    };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function movementVector(action: EnvironmentAction): { forward: number; back: number; left: number; right: number } {
  const amount = clamp01(typeof action.amount === 'number' ? action.amount : 1);
  const x = action.vector?.x ?? 0;
  const z = action.vector?.z ?? 0;

  return {
    forward: action.direction === 'forward' || z < 0 ? amount : 0,
    back: action.direction === 'back' || z > 0 ? amount : 0,
    left: action.direction === 'left' || x < 0 ? amount : 0,
    right: action.direction === 'right' || x > 0 ? amount : 0,
  };
}

export function environmentActionToMegamealLocalCommands(
  action: EnvironmentAction,
  targetSessionId?: string,
): MegamealLocalCommand[] {
  if (action.type === 'sendText') {
    const text = action.text?.trim();
    return text ? [{ type: 'sendChat', text, targetSessionId }] : [];
  }

  if (action.type === 'stop') {
    return [{ type: 'clearTouchControls', targetSessionId }];
  }

  if (action.type !== 'move') {
    return [];
  }

  const durationMs = Math.max(50, Math.min(1500, action.durationMs ?? 450));
  const movement = movementVector(action);

  const commands: MegamealLocalCommand[] = [
    {
      type: 'setTouchActionValue',
      touchId: MEGAMEAL_TOUCH_ACTION_IDS.moveForward,
      value: movement.forward,
      durationMs,
      targetSessionId,
    },
    {
      type: 'setTouchActionValue',
      touchId: MEGAMEAL_TOUCH_ACTION_IDS.moveBack,
      value: movement.back,
      durationMs,
      targetSessionId,
    },
    {
      type: 'setTouchActionValue',
      touchId: MEGAMEAL_TOUCH_ACTION_IDS.moveLeft,
      value: movement.left,
      durationMs,
      targetSessionId,
    },
    {
      type: 'setTouchActionValue',
      touchId: MEGAMEAL_TOUCH_ACTION_IDS.moveRight,
      value: movement.right,
      durationMs,
      targetSessionId,
    },
  ];

  return commands.filter(command => command.type === 'setTouchActionValue' && command.value > 0);
}
