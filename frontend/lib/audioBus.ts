"use client";

/**
 * Single-audio-owner bus.
 *
 * Browser reality: autoplay-with-sound is blocked until a user gesture,
 * so every live stream starts MUTED. Audio is opt-in, and only ONE
 * stream may be audible at a time across the whole app (feed tiles +
 * the storefront live module). This tiny module-level store holds the
 * id of the stream that currently owns audio; setting a new owner makes
 * every other IVSStageViewer instance mute itself (they subscribe and
 * re-render). Volume is a 0..1 session preference persisted to
 * sessionStorage so a viewer who set it once doesn't re-drag on every
 * client-side navigation.
 *
 * No new deps — a plain pub/sub + a React subscription hook.
 */

import { useEffect, useState } from "react";

const VOLUME_KEY = "dumclub.audio.volume.v1";

// The id (projectId) of the stream allowed to play sound right now.
// null = everything muted. Ephemeral on purpose: a fresh page load
// starts muted (autoplay policy would block sound anyway).
let _activeId: string | null = null;
// 0..1 preferred volume, persisted for the session.
let _volume = 1;
const _subs = new Set<() => void>();

function loadVolume() {
  if (typeof window === "undefined") return;
  try {
    const raw = window.sessionStorage.getItem(VOLUME_KEY);
    if (raw != null) {
      const v = Number(raw);
      if (Number.isFinite(v)) _volume = Math.min(1, Math.max(0, v));
    }
  } catch {
    /* sessionStorage unavailable (private mode quirks) — keep default */
  }
}
loadVolume();

function emit() {
  _subs.forEach((fn) => {
    try { fn(); } catch { /* ignore subscriber errors */ }
  });
}

export function getActiveAudioId(): string | null {
  return _activeId;
}

export function getAudioVolume(): number {
  return _volume;
}

/** Make `id` the sole audible stream (or null to mute all). No-op if unchanged. */
export function setActiveAudio(id: string | null): void {
  if (_activeId === id) return;
  _activeId = id;
  emit();
}

/** Set the session volume preference (0..1). Persists + notifies. */
export function setAudioVolume(v: number): void {
  const clamped = Math.min(1, Math.max(0, v));
  if (clamped === _volume) return;
  _volume = clamped;
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(VOLUME_KEY, String(clamped));
  } catch {
    /* ignore persist failure */
  }
  emit();
}

/**
 * Subscribe to the bus. Returns the current active id + volume and
 * re-renders the caller whenever either changes.
 */
export function useAudioBus(): { activeId: string | null; volume: number } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    _subs.add(fn);
    // Sync once on mount in case the bus changed between render and effect.
    fn();
    return () => { _subs.delete(fn); };
  }, []);
  return { activeId: _activeId, volume: _volume };
}
