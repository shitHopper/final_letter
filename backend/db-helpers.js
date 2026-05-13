function createHelpers(db, saveDb) {
  function all(query, params = []) {
    const stmt = db.prepare(query);
    try {
      stmt.bind(params);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      return results;
    } finally {
      stmt.free();
    }
  }

  function run(query, params = []) {
    db.run(query, params);
    saveDb();
    return db.getRowsModified();
  }

  // 关键写入：立即同步保存到磁盘，不经过节流
  function runCritical(query, params = []) {
    db.run(query, params);
    const modified = db.getRowsModified();
    saveDb.sync();
    return modified;
  }

  function get(query, params = []) {
    const results = all(query, params);
    return results[0] || null;
  }

  function runTransaction(fn, { critical = false } = {}) {
    db.run("BEGIN");
    try {
      const result = fn();
      db.run("COMMIT");
      if (critical) saveDb.sync();
      else saveDb();
      return result;
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  }

  return { all, run, runCritical, get, runTransaction };
}

module.exports = { createHelpers };
