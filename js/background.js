/* ── background.js — Service Worker ── */

import {
  getAuthStatus,
  getCurrentUser,
  redirectUri,
  signIn,
  signOut,
} from "./microsoft-auth.js";
import { getInboxPreview, searchMessages, sendMail } from "./graph-api.js";
import {
  getGeminiStatus,
  removeGeminiKey,
  saveGeminiKey,
  testGeminiConnection,
} from "./gemini-api.js";
import { answerEmail, composeEmail, summarizeInbox } from "./ai-features.js";

const qaSessions = new Map();

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
    case "GEMINI_STATUS":
      getGeminiStatus().then((status) => sendResponse({ ok: true, ...status }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      break;
    case "GEMINI_SAVE_KEY":
      handleGeminiSaveKey(message.apiKey, sendResponse);
      break;
    case "GEMINI_TEST_KEY":
      handleGeminiTestKey(message.apiKey, sendResponse);
      break;
    case "GEMINI_REMOVE_KEY":
      removeGeminiKey().then(() => sendResponse({ ok: true, configured: false }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
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

async function handleGeminiSaveKey(apiKey, sendResponse) {
  try {
    await saveGeminiKey(apiKey || "");
    sendResponse({ ok: true, configured: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

async function handleGeminiTestKey(apiKey, sendResponse) {
  try {
    await testGeminiConnection(apiKey || "");
    sendResponse({ ok: true, message: "Gemini connection succeeded." });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}

// ── Handlers ──────────────────────────────────────────────────────

async function handleSummarize({ options }, sendResponse) {
  try {
    const result = await summarizeInbox(options?.style || 'brief and professional summary of the latest 25 inbox emails');
    sendResponse({ ok: true, result: result.message, emailsUsed: result.emailsUsed });

  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "AI_ERROR" });
  }
}

async function handleSearch({ query, filter }, sendResponse) {
  try {
    if (!query || !query.trim()) {
      return sendResponse({ ok: false, error: "Query cannot be empty." });
    }

    const selectedFilter = filter || "all";

    const results = await searchMessages(query.trim(), selectedFilter);

    sendResponse({
      ok: true,
      results,
      filter: selectedFilter,
      count: results.length,
    });

  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "GRAPH_ERROR" });
  }
}

async function handleQA({ question, sessionId, isNewSession, emailContent }, sendResponse) {
  try {
    const session = qaSessions.get(sessionId) || { emailContent: emailContent || "", history: [] };
    if (emailContent) session.emailContent = emailContent;
    if (!session.emailContent) throw new Error("No email content is available for Q&A.");
    const answer = await answerEmail(session.emailContent, question, session.history);
    session.history.push({ question, answer });
    qaSessions.set(sessionId, session);
    sendResponse({ ok: true, answer, sessionId });

  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "AI_ERROR" });
  }
}

async function handleCompose({ prompt, tone, to, sender_name }, sendResponse) {
  try {
    const draft = await composeEmail(prompt, tone, to, sender_name);
    sendResponse({ ok: true, draft });

  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "AI_ERROR" });
  }
}

async function handleSend({ subject, body, recipient }, sendResponse) {
  try {
    const result = await sendMail(subject, body, recipient);
    sendResponse({ ok: true, ...result });

  } catch (err) {
    sendResponse({ ok: false, error: err.message, code: err.code || "GRAPH_ERROR" });
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
