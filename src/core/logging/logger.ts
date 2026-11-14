/**
 * logger — a framework-agnostic singleton (FRONTEND_WORKFLOW.md §5). No Vue imports, so it
 * works in services, workers and the global error handler. Components use useLogger() instead.
 * Sinks are pluggable; a sink must never throw back into the app.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: Level;
  scope: string;
  msg: string;
  data?: unknown;
  err?: { name: string; message: string; stack?: string };
}

export interface LogSink {
  write(e: LogEntry): void;
}

const ORDER: Level[] = ['debug', 'info', 'warn', 'error'];

class Logger {
  private sinks: LogSink[] = [];
  private minLevel: Level = import.meta.env.DEV ? 'debug' : 'info';

  addSink(s: LogSink) {
    this.sinks.push(s);
    return this;
  }
  setLevel(l: Level) {
    this.minLevel = l;
  }

  private emit(level: Level, scope: string, msg: string, data?: unknown, err?: unknown) {
    if (ORDER.indexOf(level) < ORDER.indexOf(this.minLevel)) return;
    const entry: LogEntry = {
      ts: Date.now(),
      level,
      scope,
      msg,
      data,
      err:
        err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : undefined,
    };
    for (const s of this.sinks) {
      try {
        s.write(entry);
      } catch {
        /* sinks are best-effort */
      }
    }
  }

  scoped(scope: string) {
    return {
      debug: (m: string, d?: unknown) => this.emit('debug', scope, m, d),
      info: (m: string, d?: unknown) => this.emit('info', scope, m, d),
      warn: (m: string, d?: unknown) => this.emit('warn', scope, m, d),
      error: (m: string, err?: unknown, d?: unknown) => this.emit('error', scope, m, d, err),
    };
  }

  debug = (m: string, d?: unknown) => this.emit('debug', 'app', m, d);
  info = (m: string, d?: unknown) => this.emit('info', 'app', m, d);
  warn = (m: string, d?: unknown) => this.emit('warn', 'app', m, d);
  error = (m: string, err?: unknown, d?: unknown) => this.emit('error', 'app', m, d, err);
}

class ConsoleSink implements LogSink {
  write(e: LogEntry) {
    const fn = e.level === 'debug' ? 'log' : e.level;
    // eslint-disable-next-line no-console
    (console as any)[fn](`[${e.scope}] ${e.msg}`, e.data ?? '', e.err ?? '');
  }
}

export const logger = new Logger();
logger.addSink(new ConsoleSink());
// Step 14 TODO: in PROD add an IdbSink (ring buffer in db.logs) + a RemoteSink via the sync engine.
