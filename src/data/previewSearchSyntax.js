/** Read one quoted token; only quote and backslash escapes are meaningful here. */
function quoted(input, start = 0) {
  let value = '';
  for (let i = start + 1; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') return { value, end: i + 1 };
    if (char === '\\') {
      i += 1;
      if (input[i] !== '"' && input[i] !== '\\') throw new Error('Use \\" or \\\\ inside quoted text.');
    }
    value += input[i];
  }
  throw new Error('Unclosed quoted text.');
}

/** Separate column targeting without interpreting colons inside quotes or regex. */
export function parsePreviewSearch(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  let separator = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') i = quoted(text, i).end - 1;
    else if (text[i] === '/') break;
    else if (text[i] === ':') { separator = i; break; }
  }
  let columns = null;
  let value = text;
  if (separator >= 0) {
    columns = [];
    const prefix = text.slice(0, separator);
    let cursor = 0;
    while (cursor < prefix.length) {
      while (/\s/.test(prefix[cursor] ?? '') && cursor < prefix.length) cursor += 1;
      let name;
      if (prefix[cursor] === '"') {
        const token = quoted(prefix, cursor);
        name = token.value;
        cursor = token.end;
      } else {
        const token = /^[\p{L}\p{N}_]+/u.exec(prefix.slice(cursor));
        if (!token) throw new Error('Quote column names containing spaces or punctuation.');
        name = token[0];
        cursor += name.length;
      }
      if (!name) throw new Error('Column names cannot be empty.');
      columns.push(name);
      while (cursor < prefix.length && /\s/.test(prefix[cursor])) cursor += 1;
      if (cursor === prefix.length) break;
      if (prefix[cursor++] !== ',' || !prefix.slice(cursor).trim()) throw new Error('Expected another column name after a comma.');
    }
    if (!columns.length) throw new Error('Specify at least one column name.');
    columns = [...new Set(columns)];
    value = text.slice(separator + 1).trim();
  }
  if (!value) throw new Error('Enter search text or a regex after the colon.');
  if (value[0] === '"') {
    const token = quoted(value);
    if (token.end !== value.length) throw new Error('Unexpected text after closing quote.');
    return { columns, text: token.value };
  }
  if (value[0] === '/') {
    let end = -1;
    for (let i = 1; i < value.length; i += 1) {
      if (value[i] === '\\') i += 1;
      else if (value[i] === '/') { end = i; break; }
    }
    if (end < 0) throw new Error('Regex must end with /, optionally followed by i or u.');
    const flags = value.slice(end + 1);
    if (!/^(?:i?u?|ui)$/.test(flags)) throw new Error('Only the regex flags i and u are supported, once each.');
    return { columns, pattern: value.slice(1, end), flags };
  }
  if (value.includes(':') || value.includes('"')) throw new Error('Quote literal text containing colons or quotes.');
  return { columns, text: value };
}

/** Compile once per search; callers execute regex in a disposable worker. */
export function createPreviewMatcher(query) {
  const regex = query.pattern != null ? new RegExp(query.pattern, query.flags) : null;
  const needle = query.text?.toLowerCase();
  return (row, columns) => columns.some((column) => {
    const value = String(row[column] ?? '');
    return regex ? regex.test(value) : value.toLowerCase().includes(needle);
  });
}
