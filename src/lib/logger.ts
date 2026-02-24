import { createLogger, format, transports } from 'winston';
import { env } from '../config/env';

export const logger = createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      if (stack) {
        return `${timestamp} [${level}] ${message} ${stack}`;
      }

      return `${timestamp} [${level}] ${message}`;
    }),
  ),
  transports: [new transports.Console()],
});
