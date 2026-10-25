import crypto from 'node:crypto';

const types = ['video', 'short', 'subtitles', 'thumbnail', 'metadata'];
export function createVideoDownloadTickets(key, now = () => Date.now()) {
  const sign = value =>
    crypto
      .createHmac('sha256', key())
      .update('video-download-v1\n' + value)
      .digest('base64url');
  return {
    issue: (id, kind) => {
      if (!types.includes(kind)) throw new Error('Invalid video file type');
      const data = Buffer.from(
        JSON.stringify({ id, kind, exp: now() + 300000, nonce: crypto.randomBytes(16).toString('hex') })
      ).toString('base64url');
      return data + '.' + sign(data);
    },
    verify: token => {
      try {
        if (typeof token !== 'string' || token.length > 1000) throw new Error();
        const [data, signature, extra] = token.split('.');
        const expected = Buffer.from(sign(data)),
          actual = Buffer.from(signature || '');
        if (extra || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error();
        const x = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (
          !/^[0-9a-f-]{36}$/i.test(x.id) ||
          !types.includes(x.kind) ||
          !Number.isSafeInteger(x.exp) ||
          x.exp <= now() ||
          x.exp > now() + 300000
        )
          throw new Error();
        return x;
      } catch {
        throw Object.assign(
          new Error('Downloadfreigabe ist ungültig oder abgelaufen. Bitte neue Downloads anfordern.'),
          { statusCode: 403 }
        );
      }
    }
  };
}
