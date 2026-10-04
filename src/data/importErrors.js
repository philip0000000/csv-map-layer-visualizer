const IMPORT_MESSAGES = Object.freeze({
  'gzip-read-failed': 'The gzip file is corrupt, truncated, or unreadable.',
  'gzip-unavailable': 'Gzip decompression is unavailable in this runtime.',
  'geojson-document-invalid': 'The GeoJSON document is malformed or incomplete. GeoJSON must use WGS84 longitude/latitude.',
  'import-size-limit': 'The expanded file exceeds the supported import size limit.',
  'csv-record-size-limit': 'A CSV record exceeds the supported size limit.',
  'unsupported-format': 'Choose a CSV or GeoJSON file, optionally compressed with gzip.',
  'file-read-failed': 'The file could not be read as a valid UTF-8 document.',
  'import-canceled': 'Import canceled.',
  'csv-import-canceled': 'Import canceled.',
});

/** Select fixed user-facing failures by code without passing raw paths or database errors. */
export function getImportErrorMessage(code) {
  return Object.hasOwn(IMPORT_MESSAGES, code) ? IMPORT_MESSAGES[code] : null;
}
