import { Suspense } from "react";

import { MeProvider } from "@/components/me-provider";
import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { getMe } from "@/lib/session";

/**
 * Everything under this layout requires a session.
 *
 * The layout itself is static, so its skeleton is served immediately. The session is
 * verified against the API inside the Suspense boundary, and the real shell streams in
 * once it is known who is asking.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <MeProvider me={me}>
      <AppShell>{children}</AppShell>
    </MeProvider>
  );
}
