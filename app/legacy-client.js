'use client';

import { useEffect } from 'react';

// Loads the single-page app. File uploads go through our own API (/api/...), which stores them
// in Vercel Blob from the server, so the browser never talks to the storage service directly.
export default function LegacyClient() {
  useEffect(() => {
    import('../public/assets/js/app.js').catch((error) => console.error('Could not load the app.', error));
  }, []);

  return null;
}
