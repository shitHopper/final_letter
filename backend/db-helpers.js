function createHelpers(db, saveDb) {
  function all(query, params = []) {
    const stmt = db.prepare(query);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }

  function run(query, params = []) {
    db.run(query, params);
    saveDb();
  }

  function get(query, params = []) {
    const results = all(query, params);
    return results[0] || null;
  }

  function runTransaction(fn) {
    db.run("BEGIN");
    try {
      fn();
      db.run("COMMIT");
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
    saveDb();
  }

  return { all, run, get, runTransaction };
}

module.exports = { createHelpers };
