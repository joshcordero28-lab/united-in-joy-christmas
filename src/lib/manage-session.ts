/** Client-side booking-session helpers. Never embed manager tokens in shared hrefs. */

export const MANAGER_TOKEN_STORAGE_KEY = "uilc_manager_token";

/** True when this browser already holds a private booking access token. */
export function hasStoredManagerToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const token = localStorage.getItem(MANAGER_TOKEN_STORAGE_KEY)?.trim() || "";
    return token.length >= 16;
  } catch {
    return false;
  }
}

/**
 * Path for “Manage My Tickets”:
 * - authorized session → `/manage` (private guest code stays in localStorage; not in the URL)
 * - otherwise → `/find` for private guest code lookup
 */
export function manageMyTicketsPath(): "/manage" | "/find" {
  return hasStoredManagerToken() ? "/manage" : "/find";
}

export function storeManagerToken(token: string): void {
  const cleaned = token.trim();
  if (cleaned.length < 16) return;
  try {
    localStorage.setItem(MANAGER_TOKEN_STORAGE_KEY, cleaned);
  } catch {
    // ignore quota / private mode
  }
}
