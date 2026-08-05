import React, { useMemo, useRef } from "react";

/**
 * Render a controlled two-handle range slider with a draggable selected range.
 * Visual positions use value-derived percentages; layout is read only while
 * translating active pointer movement back into values.
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
  const sliderRef = useRef(null);
  const dragRef = useRef({
    mode: null,
    pointerId: null,
    startStart: 0,
    startEnd: 0,
    startX: 0,
  });

  const domain = useMemo(() => {
    const normalizedMin = toInt(min);
    const normalizedMax = toInt(max);
    if (!Number.isFinite(normalizedMin) || !Number.isFinite(normalizedMax)) {
      return null;
    }
    if (normalizedMin === normalizedMax) return null;
    return {
      min: Math.min(normalizedMin, normalizedMax),
      max: Math.max(normalizedMin, normalizedMax),
    };
  }, [min, max]);

  const safe = useMemo(() => {
    if (!domain) return { start: 0, end: 0 };
    let nextStart = clamp(roundStep(toInt(start), step), domain.min, domain.max);
    let nextEnd = clamp(roundStep(toInt(end), step), domain.min, domain.max);
    if (nextStart > nextEnd) [nextStart, nextEnd] = [nextEnd, nextStart];
    return { start: nextStart, end: nextEnd };
  }, [domain, end, start, step]);

  /** Convert a pointer coordinate to a stepped value using current layout. */
  function valueFromClientX(clientX) {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || !domain || rect.width <= 0) return domain?.min ?? 0;
    const fraction = clamp((clientX - rect.left) / rect.width, 0, 1);
    const rawValue = domain.min + fraction * (domain.max - domain.min);
    return clamp(roundStep(rawValue, step), domain.min, domain.max);
  }

  /** Commit one ordered, stepped range to the controlled parent state. */
  function setNext(nextStart, nextEnd) {
    if (disabled || !domain) return;
    let normalizedStart = clamp(
      roundStep(nextStart, step),
      domain.min,
      domain.max,
    );
    let normalizedEnd = clamp(
      roundStep(nextEnd, step),
      domain.min,
      domain.max,
    );
    if (normalizedStart > normalizedEnd) {
      [normalizedStart, normalizedEnd] = [normalizedEnd, normalizedStart];
    }
    onChange?.({ start: normalizedStart, end: normalizedEnd });
  }

  /** Capture one handle or the selected segment for a pointer drag. */
  function handlePointerDown(mode, event) {
    if (disabled || !domain) return;
    event.preventDefault();
    event.stopPropagation();
    sliderRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startStart: safe.start,
      startEnd: safe.end,
      startX: event.clientX,
    };
  }

  /** Translate active pointer movement according to the captured drag mode. */
  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (disabled || !domain || drag.pointerId !== event.pointerId || !drag.mode) {
      return;
    }

    if (drag.mode === "start") {
      setNext(valueFromClientX(event.clientX), safe.end);
      return;
    }
    if (drag.mode === "end") {
      setNext(safe.start, valueFromClientX(event.clientX));
      return;
    }

    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const delta = ((event.clientX - drag.startX) / rect.width)
      * (domain.max - domain.min);
    const rangeWidth = drag.startEnd - drag.startStart;
    let nextStart = drag.startStart + delta;
    let nextEnd = nextStart + rangeWidth;

    // Clamp both edges together so dragging preserves the selected width.
    if (nextStart < domain.min) {
      nextStart = domain.min;
      nextEnd = nextStart + rangeWidth;
    }
    if (nextEnd > domain.max) {
      nextEnd = domain.max;
      nextStart = nextEnd - rangeWidth;
    }
    setNext(nextStart, nextEnd);
  }

  /** Release the active drag without changing its last committed values. */
  function finishPointerDrag(event) {
    if (dragRef.current.pointerId !== event.pointerId) return;
    sliderRef.current?.releasePointerCapture?.(event.pointerId);
    dragRef.current.mode = null;
    dragRef.current.pointerId = null;
  }

  if (!domain) {
    return <div className="dualRangeUnavailable">No range available.</div>;
  }

  const startPercent = valueToPercent(safe.start, domain);
  const endPercent = valueToPercent(safe.end, domain);
  const format = (value) => formatValue ? formatValue(value) : String(value);

  return (
    <div
      ref={sliderRef}
      className={`dualRangeSlider${disabled ? " dualRangeSliderDisabled" : ""}`}
      aria-disabled={disabled}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <div className="dualRangeTrack" />
      <div
        className="dualRangeSelection"
        style={{
          left: `${startPercent}%`,
          width: `${Math.max(0, endPercent - startPercent)}%`,
        }}
        onPointerDown={(event) => handlePointerDown("range", event)}
        role="presentation"
        aria-label="Selected range"
        title={`${format(safe.start)} – ${format(safe.end)}`}
      />
      <div
        className="dualRangeHandle dualRangeHandleStart"
        style={{ left: `${startPercent}%` }}
        onPointerDown={(event) => handlePointerDown("start", event)}
        role="slider"
        aria-label="Start"
        aria-valuemin={domain.min}
        aria-valuemax={domain.max}
        aria-valuenow={safe.start}
      />
      <div
        className="dualRangeHandle dualRangeHandleEnd"
        style={{ left: `${endPercent}%` }}
        onPointerDown={(event) => handlePointerDown("end", event)}
        role="slider"
        aria-label="End"
        aria-valuemin={domain.min}
        aria-valuemax={domain.max}
        aria-valuenow={safe.end}
      />
    </div>
  );
}

/** Convert a domain value to its horizontal position as a percentage. */
function valueToPercent(value, domain) {
  return ((value - domain.min) / (domain.max - domain.min)) * 100;
}

/** Restrict a number to the inclusive range from min through max. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Parse a base-10 integer, returning NaN when the value is invalid. */
function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Round a value to the nearest configured step, defaulting to step one. */
function roundStep(value, step) {
  const normalizedStep = Number(step) || 1;
  return Math.round(value / normalizedStep) * normalizedStep;
}
