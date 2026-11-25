"use client";

import { isServer, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import { isProblem } from "@/lib/api/problem";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A 4xx will not get better by asking again. Network errors and 5xx might.
        retry: (failureCount, error) =>
          !(isProblem(error) && error.status < 500) && failureCount < 2,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  // On the server every request gets its own client, so data never crosses users.
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "!bg-ink !text-white !border-transparent !rounded-md !shadow-overlay !font-sans !text-[13px]",
            description: "!text-white/70",
          },
        }}
      />
    </QueryClientProvider>
  );
}
