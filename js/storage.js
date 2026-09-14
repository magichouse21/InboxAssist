const KEYS = {
  auth: "microsoftAuth",
  profile: "microsoftProfile",
  geminiKey: "geminiApiKey",
};

export async function getStoredAuth() {
  const values = await chrome.storage.local.get([KEYS.auth]);
  return values[KEYS.auth] || null;
}

export async function setStoredAuth(auth) {
  await chrome.storage.local.set({ [KEYS.auth]: auth });
}

export async function getStoredProfile() {
  const values = await chrome.storage.local.get([KEYS.profile]);
  return values[KEYS.profile] || null;
}

export async function setStoredProfile(profile) {
  await chrome.storage.local.set({ [KEYS.profile]: profile });
}

export async function clearStoredMicrosoftAuth() {
  await chrome.storage.local.remove([KEYS.auth, KEYS.profile]);
}

export async function getGeminiApiKey() {
  const values = await chrome.storage.local.get([KEYS.geminiKey]);
  return values[KEYS.geminiKey] || "";
}

export async function setGeminiApiKey(apiKey) {
  await chrome.storage.local.set({ [KEYS.geminiKey]: apiKey });
}

export async function clearGeminiApiKey() {
  await chrome.storage.local.remove([KEYS.geminiKey]);
}
