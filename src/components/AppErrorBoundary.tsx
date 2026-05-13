import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // This log is intentionally structural and does not include tokens or secrets.
    console.error("Dashboard render failed", {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#1E2330] px-6 text-white">
        <section className="w-full max-w-xl rounded-lg border border-red-500/25 bg-red-500/5 p-6 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
            Dashboard render failed
          </p>
          <h1 className="mt-3 text-2xl font-bold">Pulse dashboard recovered</h1>
          <p className="mt-3 text-sm leading-6 text-white/70">
            A dashboard panel crashed before it could render. The pipeline can
            keep running, but this browser view needs a clean reload.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded border border-red-400/40 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25"
          >
            Reload dashboard
          </button>
        </section>
      </main>
    );
  }
}

export default AppErrorBoundary;
