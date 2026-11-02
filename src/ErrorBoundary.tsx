import React from 'react';
import { isChunkLoadError, reloadOnceForNewVersion } from './lib/chunkReload';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any, reloading: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, reloading: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("REACT ERROR CAUGHT:", error, errorInfo);
    // A page file from the previous deploy is gone: load the new version once instead of showing an error
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) this.setState({ reloading: true });
  }
  render() {
    if (this.state.hasError) {
      if (this.state.reloading) {
        return <div role="status" style={{ padding: '2rem', textAlign: 'center' }}>A new version of WorkPulse is available. Reloading…</div>;
      }
      const chunk = isChunkLoadError(this.state.error);
      return (
        <div role="alert" style={{ padding: '2rem', maxWidth: 560, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            {chunk ? 'This page could not be loaded' : 'Something went wrong'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            {chunk ? 'WorkPulse was updated or the connection dropped. Reload to continue.' : this.state.error?.message}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;
