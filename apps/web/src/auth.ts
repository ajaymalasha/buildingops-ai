import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

export type { SignInFailure } from "@/auth.config";

export const { handlers, signIn, signOut } = NextAuth(authConfig);
