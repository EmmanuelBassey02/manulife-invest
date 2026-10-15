'use client';

import { useEffect } from 'react';

export default function LegacyClient() {
  useEffect(() => {
    let active = true;
    import('@vercel/blob/client').then(({ upload }) => {
      if (!active) return;
      window.eiBlobUpload = async (file, purpose) => {
        const blob = await upload(file.name, file, {
          access: 'private',
          handleUploadUrl: '/api/blob/upload',
          clientPayload: JSON.stringify({ purpose, mime: file.type, name: file.name, size: file.size }),
        });
        return { pathname: blob.pathname, name: file.name, mime: file.type, size: file.size };
      };
      import('../public/assets/js/app.js');
    }).catch((error) => {
      console.error('Could not initialize secure uploads.', error);
      import('../public/assets/js/app.js');
    });
    return () => { active = false; delete window.eiBlobUpload; };
  }, []);

  return null;
}