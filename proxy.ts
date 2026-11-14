import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  // Legacy path URLs put the bearer in the path; bounce to the hash form so the
  // document URL no longer carries the secret in the path after navigation.
  const legacyTicket = request.nextUrl.pathname.match(/^\/ticket\/([^/]+)$/);
  if (legacyTicket?.[1]) {
    const url = request.nextUrl.clone();
    url.pathname = "/ticket";
    url.hash = decodeURIComponent(legacyTicket[1]);
    // Note: some intermediaries strip Location hashes; the client legacy page
    // also migrates the token into localStorage + hash as a fallback.
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data:;
    font-src 'self' data:;
    connect-src 'self';
    media-src 'self' blob:;
    worker-src 'self' blob:;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=()",
  );

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|brand/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    },
  ],
};
