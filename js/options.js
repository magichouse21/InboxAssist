document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const microsoftStatus = document.getElementById("microsoft-status");
  const authButton = document.getElementById("btn-options-auth");
  const signoutButton = document.getElementById("btn-options-signout");
  const redirect = document.getElementById("redirect-uri");
  const geminiKey = document.getElementById("gemini-key");
  const geminiStatus = document.getElementById("gemini-status");
  const geminiSave = document.getElementById("btn-gemini-save");
  const geminiTest = document.getElementById("btn-gemini-test");
  const geminiRemove = document.getElementById("btn-gemini-remove");

  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

  function renderAuth(result) {
    if (!result?.ok) {
      microsoftStatus.textContent = result?.error || "Unable to check Microsoft connection.";
      return;
    }
    const connected = result.status === "connected";
    microsoftStatus.textContent = connected
      ? `Connected as ${result.profile?.email || result.profile?.displayName || "Microsoft account"}`
      : result.status === "reauthentication_required"
        ? "Microsoft sign-in expired. Reconnect to continue."
        : "Not connected.";
    authButton.hidden = connected;
    signoutButton.hidden = !connected;
  }

  send({ type: "GET_REDIRECT_URI" }).then((result) => {
    redirect.textContent = result?.redirectUri || "Unavailable";
  });
  send({ type: "AUTH_STATUS" }).then(renderAuth);
  send({ type: "GEMINI_STATUS" }).then((result) => {
    geminiStatus.textContent = result?.configured ? "Gemini key is configured." : "Gemini key is not configured.";
  });

  authButton?.addEventListener("click", async () => {
    authButton.disabled = true;
    authButton.textContent = "Signing in…";
    renderAuth(await send({ type: "AUTH_SIGN_IN" }));
    authButton.disabled = false;
    authButton.textContent = "Sign in with Microsoft";
  });

  signoutButton?.addEventListener("click", async () => {
    renderAuth(await send({ type: "AUTH_SIGN_OUT" }));
  });

  geminiSave?.addEventListener("click", async () => {
    const result = await send({ type: "GEMINI_SAVE_KEY", apiKey: geminiKey.value });
    geminiStatus.textContent = result?.ok ? "Gemini key saved locally." : result?.error || "Unable to save Gemini key.";
    if (result?.ok) geminiKey.value = "";
  });

  geminiTest?.addEventListener("click", async () => {
    geminiTest.disabled = true;
    geminiStatus.textContent = "Testing Gemini connection…";
    const result = await send({ type: "GEMINI_TEST_KEY", apiKey: geminiKey.value });
    geminiStatus.textContent = result?.ok ? result.message : result?.error || "Gemini connection failed.";
    geminiTest.disabled = false;
  });

  geminiRemove?.addEventListener("click", async () => {
    const result = await send({ type: "GEMINI_REMOVE_KEY" });
    geminiStatus.textContent = result?.ok ? "Gemini key removed." : result?.error || "Unable to remove Gemini key.";
    geminiKey.value = "";
  });

  if (status) status.textContent = "Gemini settings will be added in the next slice.";
});
