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

function escapeODataString(value) {
  return value.replace(/'/g, "''");
}

export function buildSearchPath(query, filter = "all") {
  const encoded = query.trim();
  const params = new URLSearchParams({
    "$select": "from,subject,receivedDateTime,bodyPreview,webLink",
    "$top": "25",
  });

  if (filter === "subject") {
    params.set("$filter", `contains(subject, '${escapeODataString(encoded)}')`);
    params.set("$orderby", "receivedDateTime DESC");
  } else if (filter === "from") {
    params.set("$filter", `from/emailAddress/address eq '${escapeODataString(encoded)}'`);
    params.set("$orderby", "receivedDateTime DESC");
  } else if (filter === "date") {
    const date = new Date(encoded);
    if (Number.isNaN(date.getTime())) throw new Error("Enter a valid date, such as 2026-09-14.");
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    params.set("$filter", `receivedDateTime ge ${start.toISOString()} and receivedDateTime lt ${end.toISOString()}`);
    params.set("$orderby", "receivedDateTime DESC");
  } else {
    params.set("$search", `\"${encoded.replace(/\"/g, '\\\"')}\"`);
  }

  return `/me/messages?${params}`;
}

function serializeSearchMessage(message) {
  return {
    id: message.id,
    subject: message.subject || "(no subject)",
    from: message.from?.emailAddress?.address || "Unknown sender",
    from_name: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "Unknown sender",
    received: message.receivedDateTime || null,
    body_preview: message.bodyPreview || "",
    web_link: message.webLink || null,
  };
}

export async function searchMessages(query, filter = "all") {
  const data = await graphRequest(buildSearchPath(query, filter), {
    headers: { ConsistencyLevel: "eventual" },
  });
  return (data.value || []).map(serializeSearchMessage);
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

function serializeInboxMessage(message) {
  return {
    id: message.id,
    subject: message.subject || "(no subject)",
    from: message.from?.emailAddress?.address || "Unknown sender",
    from_name: message.from?.emailAddress?.name || message.from?.emailAddress?.address || "Unknown sender",
    received: message.receivedDateTime || null,
    body_preview: message.bodyPreview || "",
    body: message.body?.content || message.bodyPreview || "",
    web_link: message.webLink || null,
  };
}

export async function getUnreadInbox() {
  const params = new URLSearchParams({
    "$select": "from,subject,receivedDateTime,bodyPreview,body,webLink",
    "$filter": "isRead eq false",
    "$top": "25",
    "$orderby": "receivedDateTime DESC",
  });
  const data = await graphRequest(`/me/mailFolders/inbox/messages?${params}`, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  return (data.value || []).map(serializeInboxMessage);
}
