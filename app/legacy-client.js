'use client';

import { useEffect } from 'react';

// The Blob SDK hides the server's response; ask the route again to learn why it refused.
async function uploadFailureReason(pathname, clientPayload) {
  try {
    const response = await fetch('/api/blob/upload', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname, multipart: false, clientPayload } }),
    });
    if (response.ok) return null;
    const body = await response.json().catch(() => null);
    return body?.error || `The upload service returned an error (${response.status}).`;
  } catch { return 'Could not reach the upload service. Check your connection and try again.'; }
}

export default function LegacyClient() {
  useEffect(() => {
    let active = true;
    import('@vercel/blob/client').then(({ upload }) => {
      if (!active) return;
      window.eiBlobUpload = async (file, purpose) => {
        const clientPayload = JSON.stringify({ purpose, mime: file.type, name: file.name, size: file.size });
        const send = () => upload(file.name, file, { access: 'private', handleUploadUrl: '/api/blob/upload', clientPayload });
        let blob;
        try { blob = await send(); }
        catch (first) {
          if (!/client token/i.test(first.message)) throw first;
          await new Promise((resolve) => setTimeout(resolve, 800));
          try { blob = await send(); }
          catch (second) {
            const reason = await uploadFailureReason(file.name, clientPayload);
            throw new Error(reason || second.message);
          }
        }
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