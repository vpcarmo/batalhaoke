export const PRODUCTION_APP_ORIGIN = "https://batalhaoke.lovable.app";

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Auth emails always return to a trusted app origin; only local development can use its local port. */
export function authRedirectUrl(options: {
  pathname?: string;
  development?: boolean;
  localOrigin?: string;
}) {
  const pathname = options.pathname ?? "/login";
  if (options.development && options.localOrigin) {
    const local = new URL(options.localOrigin);
    if (local.protocol === "http:" && isLoopback(local.hostname)) {
      return new URL(pathname, local).toString();
    }
  }
  return new URL(pathname, PRODUCTION_APP_ORIGIN).toString();
}

export function isPasswordSetupLink(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return params.get("type") === "recovery" || params.get("type") === "invite";
}

export function isPasswordSetupEvent(event: string) {
  return event === "PASSWORD_RECOVERY";
}

export function updatePassword(
  auth: { updateUser: (attributes: { password: string }) => Promise<{ error: unknown }> },
  password: string,
) {
  return auth.updateUser({ password });
}
