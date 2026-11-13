/** Injectable randomness and clock, so test vectors can be generated deterministically. */
export type Rng = (n: number) => Uint8Array;
export type Clock = () => Date;

export const defaultRng: Rng = (n) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};
export const defaultClock: Clock = () => new Date();

export interface RuntimeOpts {
  rng?: Rng;
  now?: Clock;
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const isTimestamp = (s: unknown): s is string => typeof s === "string" && TS_RE.test(s) && !Number.isNaN(Date.parse(s));
export const toTimestamp = (d: Date): string => d.toISOString();
