import {
  MICROSOFT_AUTHORITY,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_SCOPES,
} from "./config.js";
import {
  clearStoredMicrosoftAuth,
  getStoredAuth,
  getStoredProfile,
  setStoredAuth,
  setStoredProfile,
} from "./storage.js";

const AUTH_STORAGE_VERSION = 1;
const TOKEN_REFRESH_WINDOW_MS = 60_000;

export class AuthenticationRequiredError extends Error {
  constructor(message = "Microsoft sign-in is required.") {
    super(message);
    this.name = "AuthenticationRequiredError";
    this.code = "AUTH_REQUIRED";
  }
}

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function createCodeVerifier(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function createCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return encodeBase64Url(new Uint8Array(digest));
}

function createState() {
  return createCodeVerifier(32);
}

function redirectUri() {
  return chrome.identity.getRedirectURL("oauth2");
}

function formEncode(values) {
  return new URLSearchParams(values).toString();
}

async function exchangeCode(code, verifier) {
  const response = await fetch(`${MICROSOFT_AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({
      client_id: MICROSOFT_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Microsoft token exchange failed.");
  }
  return data;
}

async function refreshToken(auth) {
  if (!auth?.refresh_token) throw new AuthenticationRequiredError();

  const response = await fetch(`${MICROSOFT_AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({
      client_id: MICROSOFT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refresh_token,
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    await clearStoredMicrosoftAuth();
    throw new AuthenticationRequiredError("Microsoft sign-in expired. Please reconnect.");
  }

  const updated = normalizeTokenResponse(data, data.refresh_token || auth.refresh_token);
  await setStoredAuth(updated);
  return updated.access_token;
}

function normalizeTokenResponse(data, fallbackRefreshToken = null) {
  return {
    version: AUTH_STORAGE_VERSION,
    access_token: data.access_token,
    refresh_token: data.refresh_token || fallbackRefreshToken,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

export async function signIn() {
  const verifier = createCodeVerifier();
  const state = createState();
  const challenge = await createCodeChallenge(verifier);
  const uri = redirectUri();

  const authorizeUrl = new URL(`${MICROSOFT_AUTHORITY}/authorize`);
  authorizeUrl.search = formEncode({
    client_id: MICROSOFT_CLIENT_ID,
    response_type: "code",
    redirect_uri: uri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const callbackUrl = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl.toString(),
    interactive: true,
  });

  if (!callbackUrl) throw new Error("Microsoft sign-in did not return a callback.");
  const callback = new URL(callbackUrl);
  const returnedState = callback.searchParams.get("state");
  const error = callback.searchParams.get("error");
  if (error) {
    throw new Error(callback.searchParams.get("error_description") || `Microsoft sign-in failed: ${error}`);
  }
  if (returnedState !== state) throw new Error("Microsoft sign-in state validation failed.");

  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Microsoft sign-in returned no authorization code.");

  const tokenData = await exchangeCode(code, verifier);
  await setStoredAuth(normalizeTokenResponse(tokenData));
  const profile = await getCurrentUser();
  await setStoredProfile(profile);
  return profile;
}

export async function getAccessToken() {
  const auth = await getStoredAuth();
  if (!auth?.access_token) throw new AuthenticationRequiredError();
  if (auth.expires_at && auth.expires_at > Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    return auth.access_token;
  }
  return refreshToken(auth);
}

export async function getCurrentUser() {
  const token = await getAccessToken();
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationRequiredError("Microsoft sign-in expired. Please reconnect.");
    throw new Error(data.error?.message || "Unable to load the Microsoft account.");
  }
  return {
    displayName: data.displayName || "Microsoft account",
    email: data.mail || data.userPrincipalName || "",
  };
}

export async function getAuthStatus() {
  const auth = await getStoredAuth();
  if (!auth?.access_token) return { status: "signed_out", profile: null };

  try {
    // Force the expiry/refresh check even when a cached profile exists.
    await getAccessToken();
    const profile = (await getStoredProfile()) || await getCurrentUser();
    await setStoredProfile(profile);
    return { status: "connected", profile };
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") {
      return { status: "reauthentication_required", profile: null };
    }
    return { status: "error", profile: null, error: error.message };
  }
}

export async function signOut() {
  await clearStoredMicrosoftAuth();
}

export { redirectUri };
