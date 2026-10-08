/**
 * A small structured logger with pino's call signatures, built on `console`.
 *
 * In production each entry is passed to console as one object, which Workers
 * Logs indexes as structured fields. In development it prints one readable
 * line. Level comes from LOG_LEVEL (default: debug in development, info in
 * production), read when logging because Workers populate process.env per
 * request.
 */

const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

type Level = keyof typeof LEVELS;
type Fields = Record<string, unknown>;

interface LogFn {
  (msg: string): void;
  (fields: Fields | Error, msg?: string): void;
}

export type Logger = Record<Level, LogFn> & {
  child(fields: Fields): Logger;
};

const isDev = () => process.env.NODE_ENV !== "production";

const threshold = () => {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && configured in LEVELS) return LEVELS[configured as Level];
  return isDev() ? LEVELS.debug : LEVELS.info;
};

/** Errors don't serialize to JSON on their own; keep what is useful. */
const serialize = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined && { cause: serialize(value.cause) }),
    };
  }
  return value;
};

const CONSOLE: Record<Level, (...args: unknown[]) => void> = {
  trace: (...args) => console.debug(...args),
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  fatal: (...args) => console.error(...args),
};

const write = (
  level: Level,
  bindings: Fields,
  args: [Fields | Error | string, string?],
) => {
  if (LEVELS[level] < threshold()) return;

  const [first, second] = args;
  // Like pino, an Error passed on its own is logged under `err`.
  const fields: Fields =
    typeof first === "string"
      ? {}
      : first instanceof Error
        ? { err: first }
        : first;
  const msg = typeof first === "string" ? first : second;

  const entry: Fields = { level, time: new Date().toISOString(), ...bindings };
  for (const [key, value] of Object.entries(fields))
    entry[key] = serialize(value);
  if (msg !== undefined) entry.msg = msg;

  if (isDev()) {
    const { level: _level, time, module, msg: message, ...rest } = entry;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    const clock = typeof time === "string" ? time.slice(11, 19) : "";
    const label = typeof module === "string" ? module : "app";
    const text = typeof message === "string" ? message : "";
    CONSOLE[level](
      `${clock} ${level.toUpperCase().padEnd(5)} [${label}] ${text}${extra}`,
    );
    return;
  }

  CONSOLE[level](entry);
};

const build = (bindings: Fields): Logger => {
  const logger = {
    child: (fields: Fields) => build({ ...bindings, ...fields }),
  } as Logger;
  for (const level of Object.keys(LEVELS) as Level[]) {
    logger[level] = ((first: Fields | Error | string, second?: string) =>
      write(level, bindings, [first, second])) as LogFn;
  }
  return logger;
};

export const logger = build({});

export const createLogger = (module: string) => logger.child({ module });
