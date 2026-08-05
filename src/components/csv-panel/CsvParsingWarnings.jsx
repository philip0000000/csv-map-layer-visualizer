import { DismissButton } from "./DismissibleMessage";

/** Show the selected CSV's non-fatal parsing results as one dismissible section. */
export default function CsvParsingWarnings({ errors, onDismiss }) {
  if (!errors?.length) return null;

  return (
    <div className="csvErrors csvDismissibleMessage">
      <DismissButton
        label="Dismiss parsing warnings"
        onDismiss={onDismiss}
      />
      <details>
        <summary>Parsing warnings ({errors.length})</summary>

        <ul>
          {errors.slice(0, 15).map((err, idx) => (
            <li key={idx}>{err}</li>
          ))}
        </ul>

        {errors.length > 15 && (
          <div className="csvErrorsMore">
            Showing first 15. More warnings exist.
          </div>
        )}
      </details>
    </div>
  );
}
