"use client";

/**
 * Single-audio-owner bus.
 *
 * Browser autoplay policy blocks sound until a user gesture, so every
 * live player starts muted. This bus enforces the other half of the
 * rule: at most ONE player is audible at a time. A player claims audio
 * by calling setActive(itsId); that sets it as the active owner and, by
 * definition, every other player (which reads isActive(theirId) === false)
 * mutes itself.
 *
 * Volume + a "sound on" intent are persisted to sessionStorage so the
 * preference survives in-app navigation (feed → storefront) without the
 * viewer re-clicking unmute on every page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type AudioBus = {
  /** Id of the one player currently allowed audio, or null when muted. */
  activeId: string | null;
  /** Claim audio for `id` (mutes everyone else), or pass null to mute all. */
  setActive: (id: string | null) => void;
  /** Free ownership held by `id` on unmount without clearing the sticky
   *  sound-on intent — so the next player can auto-resume. No-op if `id`
   *  isn't the current owner. */
  release: (id: string) => void;
  /** True when `id` is the active audio owner. */
  isActive: (id: string) => boolean;
  /** 0..1 playback volume, session-persisted, applied by the active player. */
  volume: number;
  setVolume: (v: number) => void;
  /** Sticky intent: true once the viewer has unmuted anything this session.
   *  Lets the storefront player auto-resume sound after an SPA navigation. */
  soundOn: boolean;
};

const Ctx = createContext<AudioBus | null>(null);

const VOL_KEY = "dum_audio_volume";
const SOUND_KEY = "dum_audio_sound_on";

export function AudioBusProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [volume, setVolumeState] = useState<number>(1);
  const [soundOn, setSoundOn] = useState<boolean>(false);

  // Hydrate persisted preferences once on mount.
  useEffect(() => {
    try {
      const v = window.sessionStorage.getItem(VOL_KEY);
      if (v != null) {
        const n = parseFloat(v);
        if (!Number.isNaN(n)) setVolumeState(Math.min(1, Math.max(0, n)));
      }
      setSoundOn(window.sessionStorage.getItem(SOUND_KEY) === "1");
    } catch {
      // private browsing — degrade to in-memory defaults
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    try {
      window.sessionStorage.setItem(VOL_KEY, String(clamped));
    } catch {}
  }, []);

  const setActive = useCallback((id: string | null) => {
    setActiveId(id);
    const on = id !== null;
    setSoundOn(on);
    try {
      window.sessionStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {}
  }, []);

  const release = useCallback((id: string) => {
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const isActive = useCallback((id: string) => activeId === id, [activeId]);

  return (
    <Ctx.Provider value={{ activeId, setActive, release, isActive, volume, setVolume, soundOn }}>
      {children}
    </Ctx.Provider>
  );
}

/** Returns the audio bus, or null when no provider is mounted (callers
 *  must degrade gracefully — e.g. the anonymous embed has no bus). */
export function useAudioBus(): AudioBus | null {
  return useContext(Ctx);
}
