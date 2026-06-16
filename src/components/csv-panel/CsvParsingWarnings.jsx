export default function CsvParsingWarnings({ errors }) {
  if (!errors?.length) return null;

  return (
    <details className="csvErrors">
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
  );
}
