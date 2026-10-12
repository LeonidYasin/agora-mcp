import { createRemoteJWKSet, jwtVerify } from "jose";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type VerifiedIdentity = {
  issuer: string;
  subject: string;
  displayName: string | null;
  email: string | null;
};

export interface IdentityProvider {
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<VerifiedIdentity>;
}

export function createGoogleIdentityProvider(google: { clientId: string; clientSecret: string; redirectUri: string }): IdentityProvider {
  return {
    authorizationUrl(state: string): string {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", google.clientId);
      url.searchParams.set("redirect_uri", google.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    },
    async exchange(code: string): Promise<VerifiedIdentity> {
      const body = new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUri,
        grant_type: "authorization_code",
      });
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Google token exchange failed.");
      const payload = await response.json() as { id_token?: unknown };
      if (typeof payload.id_token !== "string") throw new Error("Google did not return an ID token.");
      const verified = await jwtVerify(payload.id_token, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: google.clientId,
      });
      const subject = verified.payload.sub;
      if (!subject) throw new Error("Google identity has no subject.");
      const name = typeof verified.payload.name === "string" ? verified.payload.name : null;
      const email = verified.payload.email_verified === true && typeof verified.payload.email === "string"
        ? verified.payload.email
        : null;
      return { issuer: "https://accounts.google.com", subject, displayName: name, email };
    },
  };
}
