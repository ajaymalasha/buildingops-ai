import { z } from "zod";

export const ROLE_OPTIONS = [
  "company_admin",
  "operations_manager",
  "supervisor",
  "employee",
  "customer",
  "vendor",
] as const;

export const STATUS_OPTIONS = ["active", "suspended"] as const;

export const addMemberSchema = z.object({
  email: z.email("Enter a valid email address."),
  full_name: z.string().trim().min(1, "Enter their name.").max(200, "Use at most 200 characters."),
  role: z.enum(ROLE_OPTIONS),
  title: z.string().trim().max(120, "Use at most 120 characters."),
  password: z.string().max(128, "Use at most 128 characters."),
});

export type AddMemberValues = z.infer<typeof addMemberSchema>;

export const editMemberSchema = z.object({
  role: z.enum(ROLE_OPTIONS),
  status: z.enum(STATUS_OPTIONS),
  title: z.string().trim().max(120, "Use at most 120 characters."),
});

export type EditMemberValues = z.infer<typeof editMemberSchema>;

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random initial password, in groups of four so it is easy to read out or copy. */
export function generatePassword(groups = 4): string {
  const characters: string[] = [];
  const limit = 256 - (256 % PASSWORD_ALPHABET.length); // reject values that would bias the pick
  while (characters.length < groups * 4) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && characters.length < groups * 4) {
        characters.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]!);
      }
    }
  }
  return (characters.join("").match(/.{4}/g) ?? []).join("-");
}
