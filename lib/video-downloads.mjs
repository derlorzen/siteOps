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
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
        throw new Error('Invalid video ID');
      // 42 payload bytes + SHA-256 signature = 100 URL characters, within the
      // router's default parameter limit. Keep the full 128-bit random nonce.
      const payload = Buffer.alloc(42);
      payload[0] = 1;
      Buffer.from(id.replaceAll('-', ''), 'hex').copy(payload, 1);
      payload[17] = types.indexOf(kind);
      payload.writeBigUInt64BE(BigInt(now() + 300000), 18);
      crypto.randomBytes(16).copy(payload, 26);
      const data = payload.toString('base64url');
      return data + '.' + sign(data);
    },
    verify: token => {
      try {
        if (typeof token !== 'string' || token.length > 1000) throw new Error();
        const [data, signature, extra] = token.split('.');
        const expected = Buffer.from(sign(data)),
          actual = Buffer.from(signature || '');
        if (extra || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error();
        const payload = Buffer.from(data, 'base64url');
        let x;
        if (payload[0] === 1) {
          if (payload.length !== 42) throw new Error();
          const hex = payload.subarray(1, 17).toString('hex');
          x = {
            id: hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' +
              hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20),
            kind: types[payload[17]],
            exp: Number(payload.readBigUInt64BE(18)),
            nonce: payload.subarray(26).toString('hex')
          };
        } else {
          // Existing five-minute tickets remain valid during a rolling update.
          x = JSON.parse(payload.toString());
        }
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
