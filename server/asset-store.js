import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createAssetStore({ uploadsDir, brandingDir }) {
  const hosted = Boolean(process.env.VERCEL);

  async function sdk() { return import('@vercel/blob'); }

  return {
    hosted,
    async saveRadiograph(reportId, imageId, file) {
      const extension = file.mimetype === 'image/png' ? '.png' : '.jpg';
      if (hosted) {
        const { put } = await sdk();
        const blob = await put(`clinic-files/reports/${reportId}/${imageId}${extension}`, file.buffer, {
          access: 'private', contentType: file.mimetype, addRandomSuffix: false,
        });
        return blob.pathname;
      }
      const pathname = `${imageId}${extension}`;
      mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(join(uploadsDir, pathname), file.buffer);
      return pathname;
    },
    async saveLogo(file) {
      const extension = file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
      if (hosted) {
        const { put } = await sdk();
        const blob = await put(`clinic-files/branding/clinic-logo-${Date.now()}${extension}`, file.buffer, {
          access: 'private', contentType: file.mimetype, addRandomSuffix: true,
        });
        return blob.pathname;
      }
      const pathname = join(brandingDir, `clinic-logo-${Date.now()}${extension}`);
      mkdirSync(dirname(pathname), { recursive: true });
      writeFileSync(pathname, file.buffer);
      return pathname;
    },
    async read(pathname, localBase = uploadsDir) {
      if (!pathname) return null;
      if (hosted) {
        const { get } = await sdk();
        const result = await get(pathname, { access: 'private', useCache: false });
        if (!result || result.statusCode !== 200 || !result.stream) return null;
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      }
      try { return readFileSync(pathname.includes('\\') || pathname.includes('/') ? pathname : join(localBase, pathname)); } catch { return null; }
    },
    async remove(pathname, localBase = uploadsDir) {
      if (!pathname) return;
      if (hosted) {
        const { del } = await sdk();
        await del(pathname);
        return;
      }
      try { unlinkSync(pathname.includes('\\') || pathname.includes('/') ? pathname : join(localBase, pathname)); } catch { /* already absent */ }
    },
  };
}
