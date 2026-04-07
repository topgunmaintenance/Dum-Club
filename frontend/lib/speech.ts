/**
 * Speech synthesis utility for voice output.
 *
 * Phase 2 prep — not auto-triggered. Call `speakText()` only after
 * explicit user interaction (e.g. toggling a "read aloud" button).
 *
 * Browser support: Chrome, Safari, Edge, Firefox (desktop + mobile).
 * Falls back silently if SpeechSynthesis is unavailable.
 */

let currentUtterance: SpeechSynthesisUtterance | null = null;

/** Check if speech synthesis is available in this browser. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speak the given text. Cancels any in-progress speech first. */
export function speakText(text: string, options?: { rate?: number; pitch?: number }) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options?.rate ?? 1.0;
  utterance.pitch = options?.pitch ?? 1.0;
  utterance.lang = "en-US";
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

/** Stop any in-progress speech. */
export function stopSpeaking() {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

/** Check if speech is currently playing. */
export function isSpeaking(): boolean {
  if (!canSpeak()) return false;
  return window.speechSynthesis.speaking;
}
