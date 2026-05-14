"use client";

/**
 * OfferActionsMenu — owner-only ellipsis menu in the top-right
 * corner of each offer card.
 *
 * Replaces the inline "Edit | Deactivate" two-button group that
 * cluttered every card. Shows on hover/focus on desktop and is
 * always-visible on touch viewports (no hover state to rely on).
 *
 * Items, in order:
 *   - Edit                — opens the existing offer form
 *   - Duplicate           — clones the offer for quick variants
 *   - Deactivate          — toggles is_active=false
 *   - Feature in next stream — pins the offer for the next live
 *
 * Visibility gating is the parent's responsibility — this
 * component renders unconditionally; pass it the gated subset
 * of handlers (or omit it entirely) when the viewer is not the
 * owner OR is in "View as customer" mode.
 */

import { useEffect, useRef, useState } from "react";

interface OfferActionsMenuProps {
  /** Open the inline offer-edit form for this offer. */
  onEdit: () => void;
  /** Duplicate this offer. Implementation lives in the parent
   *  page (it has access to the create endpoint + form state). */
  onDuplicate?: () => void;
  /** Toggle is_active. Renders as "Deactivate" when the offer
   *  is currently active, "Activate" otherwise. */
  onToggleActive: () => void;
  /** Pin this offer as the featured one for the next live
   *  stream. Optional — only wire up when a pin endpoint is
   *  available. */
  onFeatureNext?: () => void;
  /** Whether the offer is currently active. Drives the
   *  Deactivate/Activate label. */
  isActive: boolean;
}

export function OfferActionsMenu({
  onEdit,
  onDuplicate,
  onToggleActive,
  onFeatureNext,
  isActive,
}: OfferActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape so the menu doesn't get
  // stranded open while the visitor scrolls / interacts.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function fire(handler: (() => void) | undefined) {
    setOpen(false);
    if (handler) handler();
  }

  return (
    <div
      ref={wrapRef}
      className="relative"
      data-dum-offer-actions
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Offer actions"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-muted hover:text-primary focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <span aria-hidden="true" className="text-base leading-none">⋯</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-lg border border-default bg-surface-card shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => fire(onEdit)}
            className="block w-full px-3 py-2 text-left text-xs font-medium text-primary transition hover:bg-surface-muted"
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onDuplicate}
            onClick={() => fire(onDuplicate)}
            className="block w-full px-3 py-2 text-left text-xs font-medium text-primary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => fire(onToggleActive)}
            className="block w-full px-3 py-2 text-left text-xs font-medium text-amber-400 transition hover:bg-surface-muted"
          >
            {isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!onFeatureNext}
            onClick={() => fire(onFeatureNext)}
            className="block w-full border-t border-default px-3 py-2 text-left text-xs font-medium text-brand-teal transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Feature in next stream
          </button>
        </div>
      )}
    </div>
  );
}
