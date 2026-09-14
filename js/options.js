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
  const indexButton = document.getElementById("btn-index-inbox");
  const indexClear = document.getElementById("btn-index-clear");
  const indexStatus = document.getElementById("index-status");

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
  send({ type: "INDEX_STATUS" }).then((result) => {
    indexStatus.textContent = result?.ok ? `${result.chunks} indexed chunks.` : result?.error || "Unable to read index status.";
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

  indexButton?.addEventListener("click", async () => {
    indexButton.disabled = true;
    indexStatus.textContent = "Indexing inbox…";
    const result = await send({ type: "INDEX_INBOX", limit: 50 });
    indexStatus.textContent = result?.ok
      ? `${result.chunksIndexed} chunks indexed from ${result.emailsProcessed} emails.`
      : result?.error || "Unable to index inbox.";
    indexButton.disabled = false;
  });

  indexClear?.addEventListener("click", async () => {
    const result = await send({ type: "INDEX_CLEAR" });
    indexStatus.textContent = result?.ok ? "Index cleared." : result?.error || "Unable to clear index.";
  });

  if (status) status.textContent = "Gemini settings will be added in the next slice.";
});
