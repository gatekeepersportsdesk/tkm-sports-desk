import React from 'react';

interface Props {
  /** changes (e.g. sport + tab) reset a tripped boundary */
  resetKey?: string;
  label?: string;
  children?: React.ReactNode;
}
interface State { error: Error | null; key?: string }

/**
 * A render error in one desk must never blank the app or reset the sport tab:
 * the header (outside this boundary) keeps working so you can switch away.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.label || 'view'}] render error`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 bg-rose-950/40 border border-rose-800 rounded-2xl text-sm font-mono text-rose-200 space-y-2">
          <div className="font-bold">The {this.props.label || 'view'} hit an error and was stopped. The rest of the app is fine.</div>
          <pre className="text-xs whitespace-pre-wrap text-rose-300/90">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 bg-[#182232] hover:bg-[#222d3e] border border-[#222d3e] rounded-lg text-xs text-white"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
