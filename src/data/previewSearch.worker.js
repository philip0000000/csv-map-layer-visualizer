import { createPreviewMatcher } from './previewSearchSyntax.js';

let matches;
// Regex runs apart from both the UI and database worker: terminating it cannot
// interrupt a database transaction or lose the browser's in-memory database.
self.onmessage = ({ data }) => {
  try {
    if (data.query) matches = createPreviewMatcher(data.query);
    const indices = data.rows?.flatMap((row, index) => matches(row, data.columns) ? [index] : []) ?? [];
    self.postMessage({ indices });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
