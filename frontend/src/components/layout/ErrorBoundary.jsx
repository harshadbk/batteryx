import { Component } from 'react'

/** Catches render errors in a page and shows a recoverable message instead of a blank app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <div className="font-semibold">This page failed to render.</div>
        <div className="mt-1 font-mono text-xs">{String(this.state.error.message || this.state.error)}</div>
        <button className="btn-secondary mt-3" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    )
  }
}
