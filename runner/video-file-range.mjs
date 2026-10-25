export function videoFileRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Video file is empty or invalid.');
  if (!header) return { status: 200, start: 0, end: size - 1, length: size };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) throw new Error('Unsupported byte range.');
  const start = Number(match[1]),
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw new Error('Invalid byte range.');
  return { status: 206, start, end, length: end - start + 1 };
}
