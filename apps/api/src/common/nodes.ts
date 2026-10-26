// Nodes are normalised city names so "jakarta " and "Jakarta" merge.
export const nodeKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export const routeKeyOf = (a: string, b: string) => [nodeKey(a), nodeKey(b)].sort().join('|');

// Calendar day in the platform timezone, used for the one-signal-per-user-per-day dedupe.
export const dayKey = (tz: string, at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
