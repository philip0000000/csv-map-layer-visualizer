import React, { useEffect, useMemo, useRef, useState } from "react";

// TODO(refactor / tech-debt):
// This slider is currently stable and works correctly across several tricky UI scenarios
// (collapse/expand, hidden mount, ResizeObserver, and layout timing issues).
//
// However, the implementation has accumulated some technical debt, including:
// - Mixed usage of measuredWidth state and direct DOM reads (getBoundingClientRect)
// - Global pointer event listeners being attached on every render
// - Complex layout timing dependencies (requestAnimationFrame + ResizeObserver)
// - Fragile coupling to visibility / mount timing
//
// IMPORTANT:
// Do NOT refactor or "simplify" this component without testing:
// - Collapse / expand of parent panels
// - Hidden mount -> visible transitions
// - Multiple instances on screen
// - Resizing the window and container
//
// This code reached its current shape through real bug-fixing, not over-engineering.
// Any cleanup should be done together with:
// - Dedicated test cases
// - Or a full rewrite with a proper layout + interaction model.

/**
 * DualRangeSlider
 * - Two handles
 * - Draggable middle range
 * - Mouse + touch support
 * - Step (integer)
 *
 * Props:
 * - min, max, step
 * - start, end (controlled)
 * - onChange({ start, end })
 * - disabled
 * - formatValue (optional)
 *
 * High-level behavior:
 * - This is a *controlled* component: it renders using `start`/`end` props
 *   and reports user interactions via `onChange`, but does not store values in state.
 * - Visually, it is a track with a highlighted range segment and two draggable handles.
 * - The highlighted range segment itself can be dragged to move the whole range together.
 */
export default function DualRangeSlider({
  min,
  max,
  step = 1,
  start,
  end,
  onChange,
  disabled = false,
  formatValue,
}) {
  // Ref to the root slider element. Used to measure pixel width and convert pixels <-> values.
  const sliderRef = useRef(null);

  // measured width stored in React state.
  // This solves a common UI issue where the slider mounts while hidden/collapsing (width=0),
  // then becomes visible later without any React state change to trigger a re-render.
  const [measuredWidth, setMeasuredWidth] = useState(0);

  // Ref to store drag interaction state without re-rendering on every pointer move.
  // - mode: which part is being dragged ("start" handle, "end" handle, or the "range" bar)
  // - pointerId: used to ensure we only respond to the active pointer
  // - startStart/startEnd: slider values at the moment drag began (baseline for dragging)
  // - startX: pointer X-coordinate at drag start (baseline for range dragging)
  const dragRef = useRef({
    mode: null, // "start" | "end" | "range"
    pointerId: null,
    startStart: 0,
    startEnd: 0,
    startX: 0,
  });

  // domain:
  // Normalizes `min`/`max` to integers and validates the slider domain.
  // If invalid (non-numeric) or degenerate (min === max), domain is null and slider can't render.
  const domain = useMemo(() => {
    const mi = toInt(min);
    const ma = toInt(max);
    if (!Number.isFinite(mi) || !Number.isFinite(ma)) return null;
    if (mi === ma) return null;
    return { min: mi, max: ma };
  }, [min, max]);

  // Convert controlled props `start` and `end` to integers for internal calculations.
  // (If they are invalid strings, toInt returns NaN.)
  const s = toInt(start);
  const e = toInt(end);

  // safe:
  // Produces a sanitized {start, end} pair that is:
  // - rounded to `step`
  // - clamped within [min, max]
  // - ordered so start <= end (swaps if needed)
  // This is what the UI uses to render.
  const safe = useMemo(() => {
    if (!domain) return { start: 0, end: 0 };
    const mi = domain.min;
    const ma = domain.max;

    let a = clamp(roundStep(s, step), mi, ma);
    let b = clamp(roundStep(e, step), mi, ma);

    // Ensure consistent ordering so the UI doesn't break if props come in reversed.
    if (a > b) [a, b] = [b, a];
    return { start: a, end: b };
  }, [domain, s, e, step]);

  /**
   * Keep `measuredWidth` in sync with the actual DOM width.
   * - ResizeObserver triggers when the element becomes visible or changes size.
   * - requestAnimationFrame ensures we measure after layout is committed.
   *
   * This is the key fix for "handles stuck until some other UI causes a re-render".
   */
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;

    function commitMeasure() {
      const rect = el.getBoundingClientRect();
      const w = Math.max(0, Math.round(rect.width));
      setMeasuredWidth((prev) => (prev === w ? prev : w));
    }

    // Initial measure after mount (after layout)
    const rafId = requestAnimationFrame(commitMeasure);

    // Observe size changes (covers collapse/expand and responsive layout)
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        // Measure on the next frame to avoid reading layout mid-update.
        requestAnimationFrame(commitMeasure);
      });
      ro.observe(el);
    } else {
      // Fallback (older browsers): re-measure on window resize
      window.addEventListener("resize", commitMeasure);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", commitMeasure);
    };
  }, []);

  /**
   * Convert a value in [domain.min, domain.max] to a pixel offset from the left edge.
   * Prefers measuredWidth (reactive), with a DOM-width fallback for first paint timing.
   */
  function pxFromValue(v) {
    if (!domain) return 0;

    // Prefer measuredWidth (reactive), but fall back to DOM width if it’s not ready yet.
    const el = sliderRef.current;
    const w =
      (Number.isFinite(measuredWidth) && measuredWidth > 0
        ? measuredWidth
        : el?.getBoundingClientRect().width) || 0;

    if (w <= 0) return 0;

    const t = (v - domain.min) / (domain.max - domain.min);
    return t * w;
  }

  /**
   * Convert a pointer clientX coordinate to a value in the slider domain.
   * - Computes relative x-position inside the slider element
   * - Converts to a domain value
   * - Rounds to step and clamps into [min, max]
   */
  function valueFromClientX(clientX) {
    const el = sliderRef.current;
    if (!el || !domain) return domain?.min ?? 0;

    const rect = el.getBoundingClientRect();
    const rel = clamp(clientX - rect.left, 0, rect.width); // pixels from left, clamped to slider width
    const t = rel / rect.width; // normalized [0..1]
    const raw = domain.min + t * (domain.max - domain.min);
    return clamp(roundStep(raw, step), domain.min, domain.max);
  }

  /**
   * setNext:
   * Centralized "commit" function for changes.
   * - Applies step rounding + clamping + ordering
   * - Calls `onChange({start, end})` to notify the parent
   * - Does nothing if disabled or domain invalid
   */
  function setNext(nextStart, nextEnd) {
    if (disabled) return;
    if (!domain) return;

    let a = clamp(roundStep(nextStart, step), domain.min, domain.max);
    let b = clamp(roundStep(nextEnd, step), domain.min, domain.max);

    if (a > b) [a, b] = [b, a];

    onChange?.({ start: a, end: b });
  }

  /**
   * onPointerDown:
   * Starts a drag interaction on either:
   * - "start" handle
   * - "end" handle
   * - "range" bar
   *
   * Stores baseline values in dragRef so pointer moves can compute deltas.
   * Captures pointer to keep receiving events even if the pointer leaves the element.
   */
  function onPointerDown(mode, e) {
    if (disabled) return;
    if (!domain) return;

    e.preventDefault();
    e.stopPropagation();

    const el = sliderRef.current;
    if (!el) return;

    // Pointer capture keeps subsequent pointer events routed to this element.
    el.setPointerCapture?.(e.pointerId);

    dragRef.current.mode = mode;
    dragRef.current.pointerId = e.pointerId;
    dragRef.current.startStart = safe.start;
    dragRef.current.startEnd = safe.end;
    dragRef.current.startX = e.clientX;
  }

  /**
   * onPointerMove:
   * Executes while dragging.
   * Guard rails:
   * - ignore when disabled or no domain
   * - ignore if pointerId doesn't match the active drag
   * - ignore if not currently dragging (no mode)
   *
   * Modes:
   * - "start": move only the start handle
   * - "end": move only the end handle
   * - "range": move the whole range while keeping width constant (clamped at edges)
   */
  function onPointerMove(e) {
    if (disabled) return;
    if (!domain) return;
    if (dragRef.current.pointerId !== e.pointerId) return;
    if (!dragRef.current.mode) return;

    const mode = dragRef.current.mode;

    // Dragging the start handle: update start, keep end fixed.
    if (mode === "start") {
      const v = valueFromClientX(e.clientX);
      setNext(v, safe.end);
      return;
    }

    // Dragging the end handle: update end, keep start fixed.
    if (mode === "end") {
      const v = valueFromClientX(e.clientX);
      setNext(safe.start, v);
      return;
    }

    // Dragging the range bar: shift both start/end by the same delta.
    if (mode === "range") {
      const el = sliderRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const dxPx = e.clientX - dragRef.current.startX; // pixel delta from drag start
      const dxT = dxPx / rect.width; // normalized delta
      const dxVal = dxT * (domain.max - domain.min); // delta in value-space

      const width = dragRef.current.startEnd - dragRef.current.startStart; // keep range width constant

      let ns = dragRef.current.startStart + dxVal;
      let ne = ns + width;

      // Clamp the entire window to stay within domain bounds.
      if (ns < domain.min) {
        ns = domain.min;
        ne = ns + width;
      }
      if (ne > domain.max) {
        ne = domain.max;
        ns = ne - width;
      }

      setNext(ns, ne);
      return;
    }
  }

  /**
   * onPointerUp:
   * Ends the drag interaction by clearing the stored mode and pointer id.
   */
  function onPointerUp(e) {
    if (dragRef.current.pointerId !== e.pointerId) return;

    dragRef.current.mode = null;
    dragRef.current.pointerId = null;
  }

  /**
   * Global pointer listeners:
   * Attaches pointermove/pointerup listeners to the window so dragging continues
   * even if the pointer leaves the slider element.
   *
   * Note:
   * - As written, this effect runs after every render (no dependency array),
   *   meaning the listeners are re-attached/removed on each render.
   *   It still works, but is less efficient than binding once.
   */
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  });

  // If domain is invalid/degenerate, render a small placeholder instead of a broken slider.
  if (!domain) {
    return (
      <div style={{ opacity: 0.8, fontSize: 12 }}>
        No range available.
      </div>
    );
  }

  // Convert the selected values to pixel offsets for rendering.
  const startPx = pxFromValue(safe.start);
  const endPx = pxFromValue(safe.end);

  // Optional display formatting for tooltips.
  const fmt = (v) => (formatValue ? formatValue(v) : String(v));

  return (
    <div
      ref={sliderRef}
      style={{
        position: "relative",
        height: 40,
        width: "100%",
        opacity: disabled ? 0.6 : 1,
        touchAction: "none", // prevents browser gestures interfering with pointer interactions
      }}
      aria-disabled={disabled}
    >
      {/* track: full background line */}
      <div
        style={{
          position: "absolute",
          top: 18,
          height: 4,
          width: "100%",
          borderRadius: 2,
          background: "rgba(255,255,255,0.15)",
        }}
      />

      {/* range: highlighted selected interval; also draggable as a whole ("range" mode) */}
      <div
        onPointerDown={(e) => onPointerDown("range", e)}
        style={{
          position: "absolute",
          top: 18,
          height: 4,
          left: startPx,
          width: Math.max(0, endPx - startPx),
          borderRadius: 2,
          background: "rgba(56,189,248,0.95)",
          cursor: disabled ? "default" : "grab",
        }}
        role="presentation"
        aria-label="Selected range"
        title={`${fmt(safe.start)} – ${fmt(safe.end)}`}
      />

      {/* start handle: draggable knob controlling the start value */}
      <div
        onPointerDown={(e) => onPointerDown("start", e)}
        style={{
          position: "absolute",
          top: 12,
          left: startPx,
          width: 16,
          height: 16,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: "rgba(56,189,248,0.95)",
          cursor: disabled ? "default" : "pointer",
        }}
        role="slider"
        aria-label="Start"
        aria-valuemin={domain.min}
        aria-valuemax={domain.max}
        aria-valuenow={safe.start}
      />

      {/* end handle: draggable knob controlling the end value */}
      <div
        onPointerDown={(e) => onPointerDown("end", e)}
        style={{
          position: "absolute",
          top: 12,
          left: endPx,
          width: 16,
          height: 16,
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: "rgba(56,189,248,0.95)",
          cursor: disabled ? "default" : "pointer",
        }}
        role="slider"
        aria-label="End"
        aria-valuemin={domain.min}
        aria-valuemax={domain.max}
        aria-valuenow={safe.end}
      />
    </div>
  );
}

/**
 * clamp:
 * Restricts n to the inclusive range [min, max].
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * toInt:
 * Parses a value as a base-10 integer.
 * Returns NaN if parsing fails.
 */
function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * roundStep:
 * Rounds v to the nearest multiple of `step`.
 * (step defaults to 1 if invalid.)
 */
function roundStep(v, step) {
  const s = Number(step) || 1;
  return Math.round(v / s) * s;
}


