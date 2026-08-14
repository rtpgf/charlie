/**
 * Local wall-clock time in an IANA zone -> an absolute instant.
 *
 * Deliberately independent of the server's timezone: every conversion names the
 * zone explicitly, so a server in UTC and a server in Chicago produce identical
 * results. Uses Intl rather than a date library -- Node ships the tz database.
 */

/** How far the named zone is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );
  return asUtc - instant.getTime();
}

/**
 * `localDate` is YYYY-MM-DD and `localTime` is HH:MM, both in `timeZone`.
 * Returns null if either is malformed.
 */
export function localToInstant(
  localDate: string,
  localTime: string,
  timeZone: string,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  if (!/^\d{2}:\d{2}$/.test(localTime)) return null;

  const naive = new Date(`${localDate}T${localTime}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;

  // Guess using the offset at the naive instant, then correct once. The second
  // pass matters across a DST boundary, where the offset differs either side.
  const firstGuess = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const corrected = new Date(naive.getTime() - zoneOffsetMs(firstGuess, timeZone));
  return corrected;
}

/** The local calendar day (YYYY-MM-DD) an instant falls on, in `timeZone`. */
export function instantToLocalDate(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/** The half-open instant range [start, end) covering a local calendar day. */
export function localDayBounds(
  localDate: string,
  timeZone: string,
): { start: Date; end: Date } | null {
  const start = localToInstant(localDate, '00:00', timeZone);
  if (!start) return null;
  // Add 24h then re-derive, so DST-shortened and -lengthened days still work.
  const nextDay = instantToLocalDate(new Date(start.getTime() + 36 * 60 * 60 * 1000), timeZone);
  const end = localToInstant(nextDay, '00:00', timeZone);
  if (!end) return null;
  return { start, end };
}

/** Human-friendly clock time for speech: "3 PM", "3:30 PM". */
export function formatLocalTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(instant)
    .replace(':00', '');
}
