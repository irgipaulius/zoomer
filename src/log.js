const LEVELS = ["debug", "info", "warn", "error"];

export function createLogger(level, out = console) {
  const min = Math.max(0, LEVELS.indexOf(level));
  const log = {};
  LEVELS.forEach((name, i) => {
    log[name] = (msg) => {
      if (i < min) return;
      const line = `${new Date().toISOString()} ${name.toUpperCase()} ${msg}`;
      (name === "warn" || name === "error" ? out.error : out.log)(line);
    };
  });
  return log;
}
