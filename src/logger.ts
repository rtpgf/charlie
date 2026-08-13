import { config, type LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[config.logLevel]) return;
  const line = { level, msg: message, ...fields };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(text);
  else console.log(text);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
