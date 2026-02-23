import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[seslog] Error caught by boundary:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
          <div
            className="rounded-xl p-8 max-w-md text-center glass-card"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex justify-center mb-4">
              <AlertTriangle size={48} style={{ color: "#ef4444" }} />
            </div>
            <h1
              className="font-semibold mb-2"
              style={{ fontSize: 18, color: "var(--text-primary)" }}
            >
              Something went wrong
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 mx-auto mt-4 px-4 py-2 rounded-lg transition-all duration-200 hover:scale-105"
              style={{
                background: "var(--accent)",
                color: "white",
                fontSize: 13,
              }}
            >
              <RefreshCw size={14} />
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
