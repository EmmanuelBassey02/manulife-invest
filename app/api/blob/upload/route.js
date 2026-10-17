import { handleUpload } from '@vercel/blob/client';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

const config = require('../../../../server/config');
const { db, insert } = require('../../../../server/db');
const auth = require('../../../../server/lib/auth');
const { initialize } = require('../../../../server/api');
const { now, HttpError } = require('../../../../server/lib/util');

export const runtime = 'nodejs';
export const maxDuration = 60;

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const documentTypes = [...imageTypes, 'application/pdf'];
const uploadPurposes = {
  property_image: { permission: 'properties', types: imageTypes },
  property_document: { permission: 'properties', types: documentTypes },
  cms_image: { permission: 'content', types: imageTypes },
  investor_document: { permission: 'documents', types: documentTypes },
  kyc_identity: { investor: true, types: documentTypes },
  kyc_address: { investor: true, types: documentTypes },
  kyc_selfie: { investor: true, types: imageTypes },
};

export async function POST(request) {
  try {
    await initialize();
    const reqHeaders = Object.fromEntries(request.headers.entries());
    const ip = reqHeaders['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    const ctx = { req: { headers: reqHeaders }, ip };
    const body = await request.json();

    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Request blocked.');
        await auth.loadSession(ctx);
        const details = JSON.parse(clientPayload || '{}');
        const purpose = uploadPurposes[details.purpose];
        if (!purpose || !purpose.types.includes(details.mime) || !Number.isInteger(details.size) || details.size < 1 || details.size > 10 * 1024 * 1024) {
          throw new HttpError(422, 'Invalid file upload request.');
        }
        if (purpose.investor) auth.requireInvestor(ctx);
        else auth.requireAdmin(ctx, purpose.permission);
        const uploadId = crypto.randomUUID();
        await insert(db, 'upload_tokens', {
          upload_id: uploadId, user_id: ctx.user.id, purpose: details.purpose,
          original_name: String(details.name || 'file').replace(/[^\w.\- ]/g, '_').slice(0, 120),
          mime: details.mime, size: details.size, pathname: null,
          created_at: now(), expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), used_at: null,
        });
        return {
          allowedContentTypes: [details.mime],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ uploadId }),
          callbackUrl: new URL('/api/blob/upload', request.url).toString(),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { uploadId } = JSON.parse(tokenPayload || '{}');
        const existing = await db.get('SELECT pathname FROM upload_tokens WHERE upload_id=?', [uploadId]);
        if (!existing) throw new Error('Upload authorization is missing.');
        if (existing.pathname === blob.pathname) return;
        if (existing.pathname) throw new Error('Upload authorization has already been used.');
        await db.run('UPDATE upload_tokens SET pathname=? WHERE upload_id=? AND pathname IS NULL', [blob.pathname, uploadId]);
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return NextResponse.json({ error: error.message || 'Upload failed.' }, { status });
  }
}