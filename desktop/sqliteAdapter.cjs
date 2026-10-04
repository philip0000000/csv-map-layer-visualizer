"use strict";

/** Adapt better-sqlite3 to the narrow statement interface shared with browser sql.js. */
function createSqliteAdapter(db) {
  return {
    run(sql, parameters) {
      if (parameters === undefined) db.exec(sql);
      else db.prepare(sql).run(...parameters);
    },
    prepare(sql) {
      const statement = db.prepare(sql);
      let iterator = null;
      let current = null;
      return {
        bind(parameters = []) { iterator?.return?.(); iterator = statement.iterate(...parameters)[Symbol.iterator](); },
        step() { const result = iterator.next(); current = result.value; return !result.done; },
        getAsObject() { return current; },
        free() { iterator?.return?.(); iterator = null; },
      };
    },
  };
}

module.exports = { createSqliteAdapter };
