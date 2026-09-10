import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary so a render error surfaces a recoverable message
 * instead of a blank white screen. Logs full details to the console for
 * diagnosis.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] render error:", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "var(--bg-page, #FAF7F1)"
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: "100%",
            borderRadius: 16,
            border: "1px solid var(--border-soft, #E8E0D3)",
            background: "var(--bg-card, #fff)",
            padding: "32px",
            textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.08)"
          }}
        >
          <p style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#C84A1F", margin: 0 }}>
            Something went wrong
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 500, color: "var(--text-default, #1A1714)", margin: "12px 0 8px" }}>
            This page hit an error
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-muted, #8A8378)", margin: "0 0 20px" }}>
            The rest of Orchestra is fine — reloading usually clears it. If it keeps happening, let us know.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              borderRadius: 999,
              background: "#C84A1F",
              color: "#fff",
              border: "none",
              padding: "10px 22px",
              fontFamily: "monospace",
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >
            Reload
          </button>
          <details style={{ marginTop: 20, textAlign: "left" }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted, #8A8378)" }}>Technical details</summary>
            <pre style={{ marginTop: 8, maxHeight: 200, overflow: "auto", fontSize: 11, lineHeight: 1.5, color: "#5A5450", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
