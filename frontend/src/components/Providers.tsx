import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { Toaster } from "./ui/sonner";
import { appQueryClient as queryClient } from "../lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {children}
          <Toaster position="bottom-right" />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
