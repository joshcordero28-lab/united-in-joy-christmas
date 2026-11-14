import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { StaffRole } from "@prisma/client";

export type StaffSessionData = {
  staffId?: string;
  username?: string;
  role?: StaffRole;
  displayName?: string;
  isLoggedIn?: boolean;
};

export type VoterSessionData = {
  attendeeId?: string;
  attendeeName?: string;
  isLoggedIn?: boolean;
};

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}

function sessionPassword(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new SessionConfigError(
      "SESSION_SECRET must be at least 32 characters. Update it in Cursor Secrets, then republish.",
    );
  }
  return secret;
}

function useSecureCookies(): boolean {
  // Hosted HTTPS apps always need Secure cookies; local http://127.0.0.1 stays off.
  const base = process.env.APP_BASE_URL || "";
  if (base.startsWith("https://")) return true;
  return process.env.NODE_ENV === "production";
}

function staffSessionOptions(): SessionOptions {
  return {
    cookieName: "uilc_staff_session",
    password: sessionPassword(),
    cookieOptions: {
      secure: useSecureCookies(),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    },
  };
}

function voterSessionOptions(): SessionOptions {
  return {
    cookieName: "uilc_voter_session",
    password: sessionPassword(),
    cookieOptions: {
      secure: useSecureCookies(),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    },
  };
}

export async function getStaffSession() {
  return getIronSession<StaffSessionData>(await cookies(), staffSessionOptions());
}

export async function getVoterSession() {
  return getIronSession<VoterSessionData>(await cookies(), voterSessionOptions());
}

export function requireStaff(
  session: StaffSessionData,
  roles?: StaffRole[],
): asserts session is StaffSessionData & {
  isLoggedIn: true;
  staffId: string;
  username: string;
  role: StaffRole;
} {
  if (!session.isLoggedIn || !session.staffId || !session.role) {
    throw new Error("UNAUTHORIZED");
  }
  if (roles && !roles.includes(session.role)) {
    throw new Error("FORBIDDEN");
  }
}
