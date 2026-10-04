export enum ErrorCode {
  CONFIG_INVALID = "CONFIG_INVALID",
  EXTERNAL_UNAVAILABLE = "EXTERNAL_UNAVAILABLE",
  EXTERNAL_CONTRACT = "EXTERNAL_CONTRACT",
  AI_INVALID_OUTPUT = "AI_INVALID_OUTPUT",
  AI_TIMEOUT = "AI_TIMEOUT",
  RISK_BLOCKED = "RISK_BLOCKED",
  PERSISTENCE_FAILED = "PERSISTENCE_FAILED",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  INTERNAL = "INTERNAL",
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public override readonly cause: unknown;
  public readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: unknown) {
    super(message, { cause });
    this.name = "AppError";
    this.code = code;
    this.context = context;
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, ctx?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/** Redacts known secret-shaped keys before any sink sees them. */
const SECRET_KEYS = /api[_-]?key|token|secret|password|authorization|auth[_-]?header|service[_-]?key/i;

export function redact(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = "[REDACTED]";
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" ? redact(item as Record<string, unknown>) : item
      );
    } else if (v && typeof v === "object") {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createConsoleLogger(scope = "gp"): Logger {
  const emit = (level: LogLevel, msg: string, ctx?: Record<string, unknown>, err?: unknown) => {
    const line = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg,
      ...(ctx ? { ctx: redact(ctx) } : {}),
      ...(err instanceof Error ? { err: { name: err.name, message: err.message, stack: err.stack } } : {}),
    };
    const text = JSON.stringify(line);
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
  };
  const root: Logger = {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, e, c) => emit("error", m, c, e),
    child: (s: string) => createChild(root, s),
  };
  return root;
}

function createChild(parent: Logger, scope: string): Logger {
  return {
    debug: (m, c) => parent.debug(`[${scope}] ${m}`, c),
    info: (m, c) => parent.info(`[${scope}] ${m}`, c),
    warn: (m, c) => parent.warn(`[${scope}] ${m}`, c),
    error: (m, e, c) => parent.error(`[${scope}] ${m}`, e, c),
    child: (s: string) => createChild(parent, `${scope}.${s}`),
  };
}
