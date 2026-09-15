import { randomUUID } from 'node:crypto';
import { SecurityError } from './errors.js';
export interface SafeUpload { storageName: string; mime: string; size: number; storageArea: 'quarantine-outside-web-root' }
export function validateUpload(originalName: string, claimedMime: string, bytes: Uint8Array, maxBytes = 5242880): SafeUpload {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20971520 || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes ||
      typeof originalName !== 'string' || originalName.length > 200) throw 0;
    let decoded = originalName;
    for (let i = 0; i < 3; i++) decoded = decodeURIComponent(decoded);
    if (/[\/\\:\u0000-\u001f%]/.test(decoded) || decoded.includes('..') || !/^[a-zA-Z0-9 _-]+\.(png|jpe?g|webp)$/i.test(decoded)) throw 0;
    const b = Buffer.from(bytes);
    const kind = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' :
      b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'jpg' :
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : undefined;
    const extension = decoded.split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
    const mime = kind === 'jpg' ? 'image/jpeg' : `image/${kind}`;
    if (!kind || extension !== kind || claimedMime !== mime) throw 0;
    return { storageName: `${randomUUID()}.${kind}`, mime, size: bytes.length, storageArea: 'quarantine-outside-web-root' };
  } catch { throw new SecurityError('INVALID_INPUT'); }
}
