/* ── content.js — Outlook DOM scraper ── */

/**
 * Injected into Outlook pages. Responds to messages from background.js
 * with the current email thread's text content.
 *
 * Outlook DOM selectors may need updating when Microsoft changes their markup.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'PING') {
    sentResponse({ pong: true });
    return true;
  }

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
    '[data-testid="message-body"]',
    '[aria-label="Message body"]',       // primary reading pane
    '[data-app-section="ReadingPane"] [role="document"]',
    '[data-app-section="ReadingPane"]',

    '.ReadingPaneContent',
    '.allowTextSelection',               // fallback
    '[role="main"] [role="document"]',

     // Outlook Live (personal accounts)
    '[aria-label="Email message"]',
    '.x_gmail_quote',           // quoted replies in live.com
    '#Item\\.UniqueBody',
 
    // Broad fallbacks
    '[role="document"]',
    '[role="main"]',
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el?.innerText?.trim()) {
        return el.innerText.trim();
      }
    } catch (err) {
      console.error(`Error occurred while querying selector: ${sel}`, err);
    }
  }

  // Last-resort: full body text (noisy)
  return document.body.innerText.trim().slice(0, 8000);
}