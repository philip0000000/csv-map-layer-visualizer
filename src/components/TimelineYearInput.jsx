import { useState } from "react";
import { commitTimelineYear, parseWholeYear } from "./timelineYearRange.js";

/** Keep typed years local until committed, while stepping the range immediately. */
export default function TimelineYearInput({ range, boundary, onCommit, onEdit }) {
  const { yearMin, yearMax, startYear, endYear } = range;
  const source = `${yearMin}/${yearMax}/${startYear}/${endYear}`;
  const [edit, setEdit] = useState({ source, draft: null });
  let draft = edit.draft;
  if (edit.source !== source) {
    // Slider, domain, and playback changes invalidate any older input draft.
    draft = null;
    setEdit({ source, draft: null });
  }
  const value = range[boundary];

  /** Restore invalid drafts or publish both validated boundaries exactly once. */
  function commit(text) {
    const next = commitTimelineYear(range, boundary, text);
    setEdit({ source, draft: null });
    if (next && (next.startYear !== startYear || next.endYear !== endYear)) {
      onCommit(next);
    }
  }

  /** Native spinner events commit immediately; text input remains an editable draft. */
  function handleChange(event) {
    onEdit?.();
    const text = event.target.value;
    // Text insertion, deletion, and paste carry an inputType; native steppers do not.
    if (event.nativeEvent.type === "input" && !event.nativeEvent.inputType) {
      commit(text);
    } else {
      setEdit({ source, draft: text });
    }
  }

  /** Commit on Enter and step whole years without the browser's draft rounding. */
  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (draft !== null) commit(draft);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onEdit?.();
      const base = parseWholeYear(draft) ?? value;
      const bounded = Math.max(yearMin, Math.min(yearMax, base));
      commit(String(bounded + (event.key === "ArrowUp" ? 1 : -1)));
    }
  }

  return (
    <input
      className="csvSelect"
      type="number"
      step={1}
      min={yearMin ?? undefined}
      max={yearMax ?? undefined}
      value={draft ?? value ?? ""}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={() => { if (draft !== null) commit(draft); }}
    />
  );
}
