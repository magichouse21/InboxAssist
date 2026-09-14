/* ── background.js — Service Worker ── */

import {
  getAuthStatus,
  getCurrentUser,
  redirectUri,
  signIn,
  signOut,
} from "./microsoft-auth.js";
import { getInboxPreview } from "./graph-api.js";

/**
 * Central message hub between popup.js and content.js.
 *
 * Message types (popup → background → content):
 *   { type: "SUMMARIZE",  options: {} }
 *   { type: "SEARCH",     query: string }
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
    case "AUTH_STATUS":
      handleAuthStatus(sendResponse);
      break;
    case "AUTH_SIGN_IN":
      handleAuthSignIn(sendResponse);
      break;
    case "AUTH_SIGN_OUT":
      handleAuthSignOut(sendResponse);
      break;
    case "GET_REDIRECT_URI":
      sendResponse({ ok: true, redirectUri: redirectUri() });
      break;
    case "INBOX_PREVIEW":
      handleInboxPreview(sendResponse);
      break;
    case "SUMMARIZE":
      handleSummarize(message, sendResponse);
      break;
    case "SEARCH":
      handleSearch(message, sendResponse);
      break;
    case "QA":
      handleQA(message, sendResponse);
      break;
    case "COMPOSE":
      handleCompose(message, sendResponse);
      break;
    case "SEND":
      handleSend(message, sendResponse);
      break;
    case "GET_EMAIL_CONTENT":
      // Popup is requesting email text directly
      getEmailContentFromTab()
        .then(content => sendResponse({ content }))
        .catch(err   => sendResponse({ content: '', error: err.message }));
      break;
    default:
      sendResponse({ error: `Unknown message type: ${type}` });
  }

  // Return true to keep the message channel open for async responses
  return true;
});

async function handleAuthStatus(sendResponse) {
  try {
    sendResponse({ ok: true, ...(await getAuthStatus()) });
  } catch (error) {
    sendResponse({ ok: false, status: "error", error: error.message });
  }
}

async function handleAuthSignIn(sendResponse) {
  try {
    const profile = await signIn();
    sendResponse({ ok: true, status: "connected", profile });
  } catch (error) {
    sendResponse({ ok: false, status: "signed_out", error: error.message });
  }
}

async function handleAuthSignOut(sendResponse) {
  try {
    await signOut();
    sendResponse({ ok: true, status: "signed_out" });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

async function handleInboxPreview(sendResponse) {
  try {
    const profile = await getCurrentUser();
    const messages = await getInboxPreview();
    sendResponse({ ok: true, profile, messages, count: messages.length });
  } catch (error) {
    sendResponse({ ok: false, error: error.message, code: error.code || "GRAPH_ERROR" });
  }
}

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

async function handleQA({ question, sessionId, isNewSession, emailContent }, sendResponse) {
  try {
    const body = {
      question,
      session_id: sessionId,
      new_session: isNewSession,
    };
    if (isNewSession) {
      // Use content sent by popup; fall back to scraping the tab if missing
      body.content = emailContent || await getEmailContentFromTab();
    }

    const res = await fetch(`${API_BASE}/qna`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) return sendResponse({ ok: false, error: data.error });
    sendResponse({ ok: true, answer: data.message, sessionId: data.session_id });

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


// ── Helpers ───────────────────────────────────────────────────────

function getEmailContentFromTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab) return reject(new Error("No active tab found"));

      try {
        await ensureContentScript(tab.id);
      } catch (e) {
        return reject(new Error("Failed to inject content script: " + e.message));
      }

      chrome.tabs.sendMessage(tab.id, { type: "GET_EMAIL_CONTENT" }, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(response?.content ?? "");
      });
    });
  });
}

// async function callClaudeAPI(prompt) {
//   const response = await fetch("https://api.anthropic.com/v1/messages", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       "x-api-key": "<YOUR_API_KEY>",
//       "anthropic-version": "2023-06-01",
//     },
//     body: JSON.stringify({
//       model: "claude-opus-4-6",
//       max_tokens: 1024,
//       messages: [{ role: "user", content: prompt }],
//     }),
//   });
//   const data = await response.json();
//   return data.content[0].text;
// }
