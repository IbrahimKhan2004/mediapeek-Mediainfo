export type LogType = 'info' | 'warn' | 'error' | 'debug';

/**
 * Helper for timestamped logging with proper console levels.
 * Supports passing additional data/errors for inspection.
 * Usage: log('Message', 'info', errorObject);
 */
export function log(
  message: string,
  type: LogType = 'info',
  ...args: unknown[]
) {
  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const prefix = `[${time}] [Analyze]`;
  const formattedMsg = `${prefix} ${message}`;

  switch (type) {
    case 'error':
      console.error(formattedMsg, ...args);
      break;
    case 'warn':
      console.warn(formattedMsg, ...args);
      break;
    case 'debug':
      console.debug(formattedMsg, ...args);
      break;
    case 'info':
    default:
      console.info(formattedMsg, ...args);
      break;
  }
}
