import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "../lib/error-reporting";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    void reportClientError(error, "boundary", info.componentStack ?? undefined);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-center py-20 animate-fade-in">
          <div className="w-20 h-20 rounded-2xl bg-danger-50 dark:bg-danger-500/10 flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-10 h-10 text-danger-400" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1.5">Algo salió mal</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
            Ha ocurrido un error inesperado. Intenta recargar la página.
          </p>
          <Button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
          >
            Recargar página
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
