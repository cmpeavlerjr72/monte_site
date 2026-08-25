// src/components/ErrorBoundary.tsx
//
// A render error anywhere below this boundary used to unmount the whole React
// tree and leave a blank white page — indistinguishable, to a visitor, from
// the server being down. Catch it and show something with a way out instead.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Shown above the message, e.g. "Scoreboard". */
  label?: string;
};

type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label ?? "", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="card"
        style={{
          maxWidth: 720,
          margin: "32px auto",
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--card)",
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "var(--brand-text)" }}>
          {this.props.label ? `${this.props.label} hit an error` : "Something went wrong"}
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
          The page failed to render. Reloading usually clears it; if it does not, the
          sim dataset may be temporarily unavailable.
        </p>
        <pre
          style={{
            margin: "0 0 14px",
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {String(error?.message ?? error)}
        </pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="ui-btn" data-on="true"
            style={{ padding: "8px 14px", fontWeight: 700 }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ui-btn" style={{ padding: "8px 14px" }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
