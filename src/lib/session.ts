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

const sessionPassword = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
};

export const staffSessionOptions: SessionOptions = {
  cookieName: "uilc_staff_session",
  password: process.env.SESSION_SECRET || "dev-session-secret-change-me-32chars-min!!",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 12,
  },
};

export const voterSessionOptions: SessionOptions = {
  cookieName: "uilc_voter_session",
  password: process.env.SESSION_SECRET || "dev-session-secret-change-me-32chars-min!!",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
  },
};

export async function getStaffSession() {
  // Ensure password is validated early in server contexts
  sessionPassword();
  return getIronSession<StaffSessionData>(await cookies(), {
    ...staffSessionOptions,
    password: sessionPassword(),
  });
}

export async function getVoterSession() {
  sessionPassword();
  return getIronSession<VoterSessionData>(await cookies(), {
    ...voterSessionOptions,
    password: sessionPassword(),
  });
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
