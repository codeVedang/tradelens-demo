import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function acquire(file: string) {
  const lock = file + ".lock",
    nonce = randomUUID();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = () =>
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce }), {
      flag: "wx",
    });
  try {
    write();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let old: { pid: number };
    try {
      old = JSON.parse(fs.readFileSync(lock, "utf8"));
      if (!Number.isInteger(old.pid) || old.pid <= 0)
        throw new Error("invalid lock");
    } catch {
      throw new Error(
        "Database lock cannot be verified. Stop other instances and inspect the lock file.",
      );
    }
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      else throw new Error("Database owner process could not be verified");
    }
    if (alive)
      throw new Error(
        "Database is already in use. Stop the other server before starting or migrating.",
      );
    fs.unlinkSync(lock);
    write();
  }
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(lock, "utf8")).nonce === nonce)
        fs.unlinkSync(lock);
    } catch {}
  };
}

/** Single-process SQLite repository. Mutations spanning records use transaction(). */
export class Store {
  private depth = 0;
  constructor(
    public db: Database,
    private file?: string,
    private SQL?: SqlJsStatic,
    private release?: () => void,
  ) {}
  static async open(file?: string) {
    const SQL = await initSqlJs();
    const release = file ? acquire(path.resolve(file)) : undefined;
    try {
      const existing =
        file && fs.existsSync(file) ? fs.readFileSync(file) : undefined;
      const db = new SQL.Database(existing);
      const version = Number(
        db.exec("PRAGMA user_version")[0]?.values[0][0] ?? 0,
      );
      if (version > 2) {
        db.close();
        throw new Error("Database version is newer than this application");
      }
      if (version < 2) {
        if (existing && file) {
          const backup = file + ".pre-v2.bak";
          if (!fs.existsSync(backup))
            fs.writeFileSync(backup, existing, { flag: "wx" });
        }
        db.run("BEGIN");
        try {
          const old = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='records'",
          ).length;
          if (old) db.run("ALTER TABLE records RENAME TO records_v1");
          db.run(
            "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id,owner)); CREATE INDEX records_owner_kind ON records(owner,kind)",
          );
          if (old)
            db.run(
              "INSERT INTO records SELECT kind,id,owner,body FROM records_v1; DROP TABLE records_v1",
            );
          db.run("PRAGMA user_version=2; COMMIT");
        } catch (error) {
          db.run("ROLLBACK");
          db.close();
          throw error;
        }
      }
      const store = new Store(db, file, SQL, release);
      if (version < 2) store.save();
      return store;
    } catch (error) {
      release?.();
      throw error;
    }
  }
  save() {
    if (this.depth || !this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.file + ".tmp", "w");
    try {
      fs.writeFileSync(fd, this.db.export());
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(this.file + ".tmp", this.file);
  }
  transaction<T>(work: () => T): T {
    if (this.depth) return work();
    const before = this.db.export();
    this.depth++;
    this.db.run("BEGIN");
    try {
      const result = work();
      this.db.run("COMMIT");
      this.depth--;
      this.save();
      return result;
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {}
      this.depth = 0;
      if (this.SQL) {
        this.db.close();
        this.db = new this.SQL.Database(before);
      }
      throw error;
    }
  }
  private query<T>(sql: string, params: string[]): T[] {
    const q = this.db.prepare(sql);
    try {
      q.bind(params);
      const out: T[] = [];
      while (q.step()) out.push(JSON.parse(q.getAsObject().body as string));
      return out;
    } finally {
      q.free();
    }
  }
  all<T = any>(kind: string, owner: string): T[] {
    return this.query("SELECT body FROM records WHERE kind=? AND owner=?", [
      kind,
      owner,
    ]);
  }
  owners(): string[] {
    const q = this.db.exec("SELECT DISTINCT owner FROM records");
    return (q[0]?.values ?? []).map((row) => String(row[0]));
  }
  bySession<T = any>(kind: string, sessionId: string, owner: string): T[] {
    return this.query(
      "SELECT body FROM records WHERE kind=? AND owner=? AND json_extract(body,'$.sessionId')=?",
      [kind, owner, sessionId],
    );
  }
  get<T = any>(kind: string, id: string, owner: string): T | undefined {
    return this.query<T>(
      "SELECT body FROM records WHERE kind=? AND id=? AND owner=?",
      [kind, id, owner],
    )[0];
  }
  put<T extends { id: string }>(kind: string, value: T, owner: string): T {
    if (!this.depth)
      return this.transaction(() => this.put(kind, value, owner));
    this.db.run("INSERT OR REPLACE INTO records VALUES (?,?,?,?)", [
      kind,
      value.id,
      owner,
      JSON.stringify(value),
    ]);
    this.save();
    return value;
  }
  delete(kind: string, id: string, owner: string): void {
    if (!this.depth)
      return this.transaction(() => this.delete(kind, id, owner));
    this.db.run("DELETE FROM records WHERE kind=? AND id=? AND owner=?", [
      kind,
      id,
      owner,
    ]);
    this.save();
  }
  close() {
    this.db.close();
    this.release?.();
  }
}
