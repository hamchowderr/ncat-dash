/** Shape codes for the sizes a shape step makes: 1080x1920 gives "9x16". */
export function shapeCode(width: number, height: number): string {
  const divisor = (a: number, b: number): number => (b === 0 ? a : divisor(b, a % b));
  const common = divisor(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / common}x${Math.round(height) / common}`;
}
