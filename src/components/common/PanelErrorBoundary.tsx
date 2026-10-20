import React from 'react';

interface Props {
  children: React.ReactNode;
  /** What to show instead of the children after a render error. */
  fallback: (error: Error) => React.ReactNode;
  /** Changing this value clears a caught error (e.g. a different record is opened). */
  resetKey?: unknown;
}

/**
 * Contains a render error to one panel (drawer / dialog) so the rest of the page and the app keep
 * working. The error is still logged; it is not hidden.
 */
class PanelErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[PanelErrorBoundary] panel failed to render:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export default PanelErrorBoundary;
