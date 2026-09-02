export const CANVAS_TEXTAREA_MIN_HEIGHT = 72
export const CANVAS_TEXTAREA_MAX_HEIGHT = 360

export function getCanvasTextareaHeight(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) return CANVAS_TEXTAREA_MIN_HEIGHT

  return Math.min(
    CANVAS_TEXTAREA_MAX_HEIGHT,
    Math.max(CANVAS_TEXTAREA_MIN_HEIGHT, Math.ceil(contentHeight)),
  )
}
