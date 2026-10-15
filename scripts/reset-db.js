'use strict';
// Deletes the local SQLite database and uploads so the next start re-seeds. Development only.
const fs = require('fs');
const config = require('../server/config');
if (config.isProd) { console.error('Refusing to reset the database in production.'); process.exit(1); }
if (config.DATABASE_URL) { console.error('reset-db only works with the local SQLite database.'); process.exit(1); }
for (const f of [config.SQLITE_PATH, `${config.SQLITE_PATH}-wal`, `${config.SQLITE_PATH}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(config.UPLOAD_DIR, { recursive: true, force: true });
console.log('Database and uploads removed. Run "npm start" to re-seed.');
