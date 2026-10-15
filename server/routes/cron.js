'use strict';
const config = require('../config');
const { HttpError, now } = require('../lib/util');
const engine = require('../lib/engine');

function register(r) {
  r.get('/api/cron/tick', async (ctx) => {
    if (!config.CRON_SECRET || ctx.req.headers.authorization !== `Bearer ${config.CRON_SECRET}`) {
      throw new HttpError(401, 'Unauthorized.');
    }
    await engine.tick();
    return { ok: true, checked_at: now() };
  });
}

module.exports = { register };