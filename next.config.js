const path = require('path');

module.exports = {
  turbopack: { root: path.resolve(__dirname) },
  serverExternalPackages: ['node:sqlite'],
  outputFileTracingIncludes: {
    '/api/[...path]': ['./server/db/schema.sql', './public/assets/i18n/*.json', './public/assets/js/**/*.js', './server/**/*.js'],
    '/api/blob/upload': ['./server/db/schema.sql'],
  },
};