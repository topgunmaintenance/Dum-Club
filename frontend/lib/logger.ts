/**
 * logger — dev-only console helpers.
 *
 * `log()` and `warn()` are no-ops in production; in development they
 * forward to the corresponding console method. Use these in place of
 * raw `console.log` / `console.warn` so the production bundle ships
 * without debug chatter.
 *
 * `error()` always logs (errors are operationally useful in prod logs
 * and Sentry-style aggregators). Use it inside catch blocks.
 *
 * Single source of truth so a future refactor to a real logging
 * library only touches this file.
 */

const isDev =
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "production";

type Fn = (...args: unknown[]) => void;

const noop: Fn = () => {};

export const log: Fn = isDev ? console.log.bind(console) : noop;
export const warn: Fn = isDev ? console.warn.bind(console) : noop;
export const error: Fn = console.error.bind(console);
