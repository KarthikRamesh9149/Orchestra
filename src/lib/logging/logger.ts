import pino, { type LoggerOptions } from "pino";

export function createLogger(level: string) {
  const options: LoggerOptions = {
    level,
    transport:
      process.env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true
            }
          }
        : undefined
  };

  return pino(options);
}
