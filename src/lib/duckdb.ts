import * as duckdb from "@duckdb/duckdb-wasm";

// Local (same-origin) asset URLs — served by Vite from node_modules
const DUCKDB_BUNDLE_MVP = {
  mainModule: new URL("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm", import.meta.url).toString(),
  mainWorker: new URL("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js", import.meta.url).toString(),
  // no pthread worker for MVP
};

let _conn: duckdb.AsyncDuckDBConnection | null = null;

export async function getDuckConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (_conn) return _conn;
  // Same-origin worker (no type:"module" needed for this worker)
  const worker = new Worker(DUCKDB_BUNDLE_MVP.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  const db = new duckdb.AsyncDuckDB(logger, worker);

  await db.instantiate(DUCKDB_BUNDLE_MVP.mainModule);
  const conn = await db.connect();

  // Enable HTTPFS for remote Parquet (Hugging Face etc.)
  await conn.query(`
    INSTALL httpfs;
    LOAD httpfs;
    SET enable_http_metadata_cache = true;
    SET enable_http_parquet_cache   = true;
  `);

  _conn = conn;
  return conn;
}
