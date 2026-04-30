/* ── content.js — Outlook DOM scraper ── */

/**
 * Injected into Outlook pages. Responds to messages from background.js
 * with the current email thread's text content.
 *
 * Outlook DOM selectors may need updating when Microsoft changes their markup.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_EMAIL_CONTENT') {
    const content = scrapeEmailContent();
    sendResponse({ content });
  }
  return true;
});

function scrapeEmailContent() {
  // ── Outlook Web (outlook.live.com / outlook.office.com) ──
  // These selectors target the reading pane. Adjust as needed.
  const selectors = [
    '[aria-label="Message body"]',       // primary reading pane
    '.ReadingPaneContent',
    '[data-app-section="ReadingPane"]',
    '.allowTextSelection',               // fallback
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) {
      return el.innerText.trim();
    }
  }

  // Last-resort: full body text (noisy)
  return document.body.innerText.trim().slice(0, 8000);
}