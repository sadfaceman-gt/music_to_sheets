/** True when keyboard focus is somewhere text is typed, where tool shortcuts must stay out of the way. */
export function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
