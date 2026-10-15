'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../server/config');
const { schemaFor } = require('../server/db');

async function main() {
  const sourcePath = process.env.SOURCE_SQLITE_PATH || config.SQLITE_PATH;
  const targetUrl = process.env.DATABASE_URL;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!targetUrl || !/^postgres(ql)?:\/\//.test(targetUrl)) throw new Error('Set DATABASE_URL to the empty Vercel Postgres/Neon database.');
  if (!blobToken) throw new Error('Set BLOB_READ_WRITE_TOKEN for the connected private Vercel Blob store.');
  if (!fs.existsSync(sourcePath)) throw new Error(`Source SQLite database not found: ${sourcePath}`);

  const { Pool } = require('pg');
  const { put } = await import('@vercel/blob');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const pool = new Pool({ connectionString: targetUrl, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
  try {
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map((row) => row.name);
    if (!tables.includes('users') || !tables.includes('files')) throw new Error('Source database does not have the expected EstateInvest schema.');

    await pool.query(schemaFor('pg'));
    const targetTables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()");
    for (const { tablename } of targetTables.rows) {
      if (!tables.includes(tablename)) continue;
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM "${tablename}"`);
      if (result.rows[0].count > 0) throw new Error(`Target table ${tablename} is already populated. Migration stopped.`);
    }

    const fileRows = source.prepare('SELECT id, stored_name, mime FROM files ORDER BY id').all();
    const blobPaths = new Map();
    for (const file of fileRows) {
      const sourceFile = path.join(config.UPLOAD_DIR, path.basename(file.stored_name));
      if (!fs.existsSync(sourceFile)) throw new Error(`Source upload for file id ${file.id} is missing: ${sourceFile}`);
      const pathname = `estateinvest-migration/${file.id}/${path.basename(file.stored_name)}`;
      const blob = await put(pathname, fs.readFileSync(sourceFile), {
        access: 'private', token: blobToken, contentType: file.mime, allowOverwrite: true, addRandomSuffix: false,
      });
      blobPaths.set(file.id, blob.pathname);
    }

    const client = await pool.connect();
    const counts = {};
    try {
      await client.query('BEGIN');
      for (const table of tables) {
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unexpected source table name: ${table}`);
        const rows = source.prepare(`SELECT * FROM "${table}"`).all();
        const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
        counts[table] = rows.length;
        for (let offset = 0; offset < rows.length; offset += 100) {
          const batch = rows.slice(offset, offset + 100);
          const values = [];
          const tuples = batch.map((row, rowIndex) => {
            const cells = columns.map((column) => {
              const value = table === 'files' && column === 'stored_name' ? blobPaths.get(row.id) : row[column];
              values.push(value);
              return `$${values.length}`;
            });
            return `(${cells.join(',')})`;
          });
          await client.query(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(',')}) VALUES ${tuples.join(',')}`, values);
        }
        if (columns.includes('id')) {
          await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"','id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log('Migration completed. Source files were left untouched. Imported rows:', counts);
  } finally {
    source.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});