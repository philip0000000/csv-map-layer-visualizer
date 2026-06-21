import { useRef, useState } from "react";

export function useCsvFileDrop({ onImportFiles }) {
  /** True when CSV files are being dragged over the app */
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  /**
   * Ref used to track drag enter/leave depth.
   * This prevents flicker when dragging over child elements.
   */
  const dragDepthRef = useRef(0);

  /**
   * Detect when the user drags files over the app.
   * We only show the overlay for real file drags.
   */
  function isFileDrag(e) {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes("Files");
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!isFileDrag(e)) return;

    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!isFileDrag(e)) return;
    if (!isDraggingFiles) setIsDraggingFiles(true);

    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();

    if (!isFileDrag(e)) return;

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();

    dragDepthRef.current = 0;
    setIsDraggingFiles(false);

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const csvFiles = files.filter((file) => {
      const name = String(file?.name ?? "").toLowerCase();
      return name.endsWith(".csv") || file?.type === "text/csv";
    });

    if (csvFiles.length === 0) return;

    onImportFiles(csvFiles);
  }

  return {
    isDraggingFiles,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
