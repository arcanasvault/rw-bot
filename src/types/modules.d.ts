/* eslint-disable @typescript-eslint/no-unused-vars */

declare module 'telegraf-ratelimit' {
  import type { Context, MiddlewareFn } from 'telegraf';

  interface RateLimitConfig<C extends Context = Context> {
    window: number;
    limit: number;
    keyGenerator?: (ctx: C) => string;
    onLimitExceeded?: (ctx: C, next: () => Promise<void>) => void | Promise<void>;
  }

  function rateLimit<C extends Context = Context>(config: RateLimitConfig<C>): MiddlewareFn<C>;
  export default rateLimit;
}

declare module 'node-cron' {
  interface ScheduleOptions {
    timezone?: string;
    noOverlap?: boolean;
    maxExecutions?: number;
  }

  interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy(): void;
  }

  function schedule(
    expression: string,
    task: () => void | Promise<void>,
    options?: ScheduleOptions,
  ): ScheduledTask;

  const cron: { schedule: typeof schedule };
  export default cron;
}
