let innerDialogueVisible = false;

export function setInnerDialogueSpeechVisible(visible: boolean): void {
  innerDialogueVisible = visible;
}

export function isInnerDialogueSpeechVisible(): boolean {
  return innerDialogueVisible;
}

export function shouldPlayAdmittedSpeech(mode: unknown): boolean {
  return mode !== 'inner' || innerDialogueVisible;
}
