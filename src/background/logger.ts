/**
 * Service worker logger utility.
 * Logs only in development mode or when __VERIPIXEL_DEBUG__ is active.
 */
export const isDebugEnabled = (): boolean => {
  if (import.meta.env.DEV) {
    return true;
  }
  try {
    return Boolean((globalThis as Record<string, unknown>).__VERIPIXEL_DEBUG__);
  } catch {
    return false;
  }
};

export const logger = {
  log: (...args: unknown[]): void => {
    if (isDebugEnabled()) {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]): void => {
    if (isDebugEnabled()) {
      console.warn(...args);
    }
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  }
};
