import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('KinoFlow Studio render error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleResetLocalData = (): void => {
    try {
      window.localStorage.removeItem('kinoflow_generation_history_v1');
      window.localStorage.removeItem('kinoflow_generation_settings_v1');
    } catch {
      // Ignore storage access failures
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0D11] p-6 text-[#E6E9F0]">
        <div
          role="alert"
          className="w-full max-w-lg rounded-lg border border-[#7F1D1D] bg-[#141821] p-6"
        >
          <h1 className="font-[var(--font-display)] text-lg font-bold text-[#F8FAFC]">
            Ошибка запуска интерфейса KinoFlow Studio
          </h1>
          <p className="mt-2 text-sm text-[#CBD5E1]">
            После обновления в сохранённых данных приложения могла остаться несовместимая запись.
            Попробуйте перезагрузить окно или сбросить локальный кеш настроек.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-[#222734] bg-[#0B0D11] p-3 font-mono text-xs text-[#FCA5A5]">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-[#E58E26] px-4 py-2 text-xs font-semibold text-[#0B0D11] hover:bg-[#EE9B38]"
            >
              Перезагрузить
            </button>
            <button
              type="button"
              onClick={this.handleResetLocalData}
              className="rounded-md border border-[#3A4358] bg-[#1A1F2B] px-4 py-2 text-xs font-medium text-[#E2E8F0] hover:bg-[#222838]"
            >
              Сбросить кеш настроек и перезапустить
            </button>
          </div>
        </div>
      </div>
    );
  }
}
