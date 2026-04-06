/*
  Sentry Error Tracking Wrapper

  All exports are no-ops when SENTRY_DSN is not set.
  The pipeline works identically with or without Sentry configured.

  Compatible with @sentry/node v8.x.
*/

let Sentry = null;
let initialized = false;

function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }

  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.2,
    });
    initialized = true;
    console.log('[sentry] Initialized');
  } catch (err) {
    console.log(`[sentry] Failed to initialize: ${err.message}`);
    Sentry = null;
  }
}

function addBreadcrumb(message, category) {
  if (!initialized || !Sentry) return;
  Sentry.addBreadcrumb({ message, category, level: 'info' });
}

function captureException(err, context) {
  if (!initialized || !Sentry) return;
  Sentry.captureException(err, { extra: context || {} });
}

function sentryExpressMiddleware() {
  const noop = (req, res, next) => next();
  const noopError = (err, req, res, next) => next(err);

  if (!initialized || !Sentry) {
    return { requestHandler: noop, errorHandler: noopError };
  }

  // Sentry v8 uses setupExpressErrorHandler; v7 uses Handlers
  let requestHandler = noop;
  let errorHandler = noopError;

  if (Sentry.Handlers) {
    // v7 API
    requestHandler = Sentry.Handlers.requestHandler();
    errorHandler = Sentry.Handlers.errorHandler();
  } else if (typeof Sentry.setupExpressErrorHandler === 'function') {
    // v8 API — error handler is applied directly to the app via setupExpressErrorHandler
    // We return a flag so the caller can apply it
    errorHandler = '__sentry_v8__';
  }

  return { requestHandler, errorHandler };
}

/**
 * For Sentry v8, call this after all routes to install the error handler.
 * Safe to call when Sentry is not initialized — it's a no-op.
 */
function setupErrorHandler(app) {
  if (!initialized || !Sentry) return;
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  }
}

module.exports = { initSentry, addBreadcrumb, captureException, sentryExpressMiddleware, setupErrorHandler };
