document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const microsoftStatus = document.getElementById("microsoft-status");
  const authButton = document.getElementById("btn-options-auth");
  const signoutButton = document.getElementById("btn-options-signout");
  const redirect = document.getElementById("redirect-uri");

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

  if (status) status.textContent = "Gemini settings will be added in the next slice.";
});
