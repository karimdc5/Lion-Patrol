import { Component, type ComponentChildren } from 'preact';

/** Last-resort screen: never show a blank page. Drafts and queued work live in IndexedDB. */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  override state = { error: null as Error | null };
  override componentDidCatch(error: Error) {
    this.setState({ error });
    console.error('Lion Patrol crashed:', error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div class="screen" style={{ justifyContent: 'center', padding: 24 }} role="alert">
        <div class="stack" style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
          <div class="title">Something went wrong</div>
          <p class="muted sub">Your saved reports, scans and photos are safe on this phone and will still upload. Reload to continue.</p>
          <button class="btn btn-primary btn-lg btn-block" onClick={() => location.reload()}>Reload Lion Patrol</button>
          <p class="foot faint">{String(this.state.error.message).slice(0, 160)}</p>
        </div>
      </div>
    );
  }
}
