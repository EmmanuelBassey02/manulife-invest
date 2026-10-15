const path = require('path');

module.exports = {
  turbopack: { root: path.resolve(__dirname) },
  serverExternalPackages: ['node:sqlite'],
  outputFileTracingIncludes: {
    '/api/[...path]': ['./server/db/schema.sql'],
    '/api/blob/upload': ['./server/db/schema.sql'],
  },
};