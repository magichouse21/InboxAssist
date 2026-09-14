import { GRAPH_API_BASE } from "./config.js";
import { AuthenticationRequiredError, getAccessToken } from "./microsoft-auth.js";

async function graphRequest(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationRequiredError("Microsoft sign-in expired. Please reconnect.");
    throw new Error(data.error?.message || "Microsoft Graph request failed.");
  }
  return data;
}

export async function getInboxPreview() {
  const params = new URLSearchParams({
    "$select": "from,subject,receivedDateTime,bodyPreview,webLink",
    "$top": "3",
    "$orderby": "receivedDateTime DESC",
  });
  const data = await graphRequest(`/me/mailFolders/inbox/messages?${params}`);
  return (data.value || []).map((message) => ({
    id: message.id,
    subject: message.subject || "(no subject)",
    from: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "Unknown sender",
    received: message.receivedDateTime || null,
    bodyPreview: message.bodyPreview || "",
    webLink: message.webLink || null,
  }));
}
