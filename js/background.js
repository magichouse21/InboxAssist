/* ── background.js — Service Worker ── */

/**
 * Central message hub between popup.js and content.js.
 *
 * Message types (popup → background → content):
 *   { type: "SUMMARIZE",  options: {} }
 *   { type: "SEARCH",     query: string }
 *  
 *   { type: "COMPOSE",    prompt: string, tone: string, to: string, sender_name: string }
 *   { type: "SEND",       subject: string, body: string, recipient: string }
 *   { type: "GET_EMAIL_CONTENT" }  ← forwarded to content.js
 *
 * Responses are forwarded back to the popup via sendResponse().
 */

const API_BASE = "http://localhost:5000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  switch (type) {
    case "SUMMARIZE":
      handleSummarize(message, sendResponse);
      break;
    case "SEARCH":
      handleSearch(message, sendResponse);
      break;
    case "COMPOSE":
      handleCompose(message, sendResponse);
      break;
    case "SEND":
      handleSend(message, sendResponse);
      break;
    default:
      sendResponse({ error: `Unknown message type: ${type}` });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

// ── Handlers ──────────────────────────────────────────────────────

async function handleSummarize({ options }, sendResponse) {
  try {
    const style = 'brief and professional summary of the latest 25 inbox emails';

    const res = await fetch(`${API_BASE}/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style }),
    });

    const data = await res.json();
    if (!res.ok) return sendResponse({ ok: false, error: data.error });
    sendResponse({ ok: true, result: data.message, emailsUsed: data.emails_used });

  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleSearch({ query, filter }, sendResponse) {
  try {
    if (!query || !query.trim()) {
      return sendResponse({ ok: false, error: "Query cannot be empty." });
    }

    const selectedFilter = filter || "all";

    console.log("BACKGROUND SEARCH:", {
      query: query.trim(),
      filter: selectedFilter,
    });

    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim(),
        filter: selectedFilter,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return sendResponse({ ok: false, error: data.error });
    }

    sendResponse({
      ok: true,
      results: data.results,
      filter: data.filter,
      count: data.count,
    });

  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleCompose({ prompt, tone, to, sender_name }, sendResponse) {
  try {
    const res = await fetch(`${API_BASE}/write-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: prompt,
        tone,
        recipient: to,
        sender_name,
      }),
    });

    const data = await res.json();
    if (!res.ok) return sendResponse({ ok: false, error: data.error });
    sendResponse({ ok: true, draft: data }); // { subject, body }

  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function handleSend({ subject, body, recipient }, sendResponse) {
  try {
    const res = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, recipient }),
    });

    const data = await res.json();
    if (!res.ok) return sendResponse({ ok: false, error: data.error });
    sendResponse({ ok: true, message: data.message });

  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}


// ── Content Script Injection ─────────────────────────────────────
async function ensureContentScript(tabId) {
  return new Promise((resolve) => {
    // Ping the tab — if content.js is alive it responds immediately
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
      if (chrome.runtime.lastError || !response?.pong) {
        // Not injected yet — inject now
        chrome.scripting.executeScript(
          { target: { tabId }, files: ['js/content.js'] },
          () => {
            // Small delay so the listener registers before we use it
            setTimeout(resolve, 100);
          }
        );
      } else {
        resolve(); // already injected
      }
    });
  });
}

