document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  if (status && typeof chrome !== "undefined" && chrome.runtime?.id) {
    status.textContent = "Settings are ready.";
  }
});
