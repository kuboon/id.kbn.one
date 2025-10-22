export const concat = (parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

export const equals = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const copy = (
  source: Uint8Array,
  destination: Uint8Array,
  destinationOffset = 0,
): number => {
  destination.set(source, destinationOffset);
  return destinationOffset + source.length;
};
