/** Render the shared close control used by persistent user-facing messages. */
export function DismissButton({ label, onDismiss }) {
  return (
    <button
      type="button"
      className="csvDismissButton"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onDismiss?.();
      }}
    >
      <svg
        className="csvDismissButtonIcon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

/** Preserve a message's existing role and severity while adding dismissal UI. */
export function DismissibleMessage({
  children,
  className = "",
  dismissLabel,
  onDismiss,
  role,
}) {
  return (
    <div className={`${className} csvDismissibleMessage`.trim()} role={role}>
      <DismissButton label={dismissLabel} onDismiss={onDismiss} />
      {children}
    </div>
  );
}
