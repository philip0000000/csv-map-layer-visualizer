/** File picker extensions for the two supported document formats and gzip wrappers. */
export const IMPORT_FILE_ACCEPT = '.csv,.csv.gz,.geojson,.geojson.gz';

/** Classify a filename without trusting MIME types or accepting arbitrary .gz files. */
export function getImportFileFormat(fileName) {
  const match = String(fileName ?? '').match(/\.(csv|geojson)(\.gz)?$/i);
  return match ? { format: match[1].toLowerCase(), compressed: !!match[2] } : null;
}

/** Preserve the source basename while selecting the requested export extension. */
export function getDatasetExportFileName(fileName, format) {
  if (!['csv', 'geojson'].includes(format)) throw new TypeError('Unsupported export format.');
  const name = String(fileName ?? '').trim();
  if (!name) throw new TypeError('An export filename is required.');
  return name.replace(/\.(csv|geojson)(\.gz)?$/i, '') + '.' + format;
}
