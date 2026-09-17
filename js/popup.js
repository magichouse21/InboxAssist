/* ── InboxAssist popup.js ── */

document.addEventListener('DOMContentLoaded', () => {

  // ── Microsoft connection state ────────────────────────────────
  const connectionPanel = document.getElementById('connection-panel');
  const connectionMessage = document.getElementById('connection-message');
  const authButton = document.getElementById('btn-auth');
  const inboxButton = document.getElementById('btn-inbox-preview');
  const inboxPreview = document.getElementById('inbox-preview');
  const statusLabel = document.querySelector('.status-label');
  const statusDot = document.querySelector('.status-dot');

  const send = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));

  function renderConnection(result) {
    const connected = result?.status === 'connected';
    const expired = result?.status === 'reauthentication_required';
    statusLabel.textContent = connected ? 'Connected' : expired ? 'Reconnect' : 'Not connected';
    statusDot.style.background = connected ? '#34d399' : '#f59e0b';
    connectionPanel.hidden = connected;
    authButton.textContent = expired ? 'Reconnect Microsoft' : 'Sign in with Microsoft';
    connectionMessage.textContent = expired
      ? 'Your Microsoft sign-in expired. Reconnect to continue.'
      : result?.error || 'Sign in with your personal Microsoft account to use InboxAssist.';
    inboxButton.hidden = !connected;
    return connected;
  }

  send({ type: 'AUTH_STATUS' }).then(renderConnection);

  authButton?.addEventListener('click', async () => {
    authButton.disabled = true;
    authButton.textContent = 'Signing in…';
    const result = await send({ type: 'AUTH_SIGN_IN' });
    renderConnection(result);
    authButton.disabled = false;
  });

  inboxButton?.addEventListener('click', async () => {
    inboxButton.disabled = true;
    inboxButton.textContent = 'Checking inbox…';
    const result = await send({ type: 'INBOX_PREVIEW' });
    inboxButton.disabled = false;
    inboxButton.textContent = 'Test inbox access';
    if (!result?.ok) {
      connectionMessage.textContent = result?.error || 'Inbox access failed.';
      if (result?.code === 'AUTH_REQUIRED') renderConnection({ status: 'reauthentication_required' });
      return;
    }
    inboxPreview.hidden = false;
    inboxPreview.innerHTML = `<p>Connected as ${escapeHtml(result.profile.email || result.profile.displayName)}</p>` +
      result.messages.map((message) => `<div class="card"><strong>${escapeHtml(message.subject)}</strong><br><span>${escapeHtml(message.from)}</span></div>`).join('');
  });

  // ── Tab navigation ──────────────────────────────────────────────
  const tabItems = document.querySelectorAll('.tab-item');
  const views    = document.querySelectorAll('.view');

  tabItems.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.target;

      tabItems.forEach(t => t.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // ── Filter chips (single-select) ────────────────────────────────
  document.querySelectorAll('.filter-row').forEach(row => {
    row.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        row.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  });

  let searchMode = 'smart';
  const searchButton = document.getElementById('btn-search');
  const keywordFilters = document.getElementById('keyword-search-filters');
  document.querySelectorAll('.search-mode-row .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      searchMode = chip.dataset.searchMode;
      document.querySelectorAll('.search-mode-row .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      keywordFilters.hidden = searchMode !== 'keyword';
      searchButton.textContent = searchMode === 'smart' ? 'Find Best Matches' : 'Search Inbox';
    });
  });

  // ── Tone chips (single-select) ──────────────────────────────────
  document.querySelectorAll('.tone-chips').forEach(group => {
    group.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        group.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  });

  // ── Summarize ───────────────────────────────────────────────────
  document.getElementById('btn-summarize')?.addEventListener('click', () => {
    const output = document.getElementById('summary-output');
    const bullets = document.getElementById('toggle-bullets')?.checked;
    setLoading(output);

    chrome.runtime.sendMessage(
      { type: 'SUMMARIZE', options: { bullets } },
      ({ ok, result, error }) => {
        output.replaceChildren();
        const message = document.createElement('p');
        message.className = 'summary-text';
        message.textContent = ok ? result : error;
        if (!ok) message.style.color = 'red';
        output.appendChild(message);
      }
    );
  });

// ── Search ──────────────────────────────────────────────────────
document.getElementById('btn-search')?.addEventListener('click', () => {
  const query   = document.getElementById('search-input')?.value.trim();
  const results = document.getElementById('search-results');

  const activeChip = document.querySelector('#keyword-search-filters .filter-chip.active');
  const filter = activeChip?.dataset.filter || 'all';

  if (!query) return;
  setLoading(results);
  const searchButton = document.getElementById('btn-search');
  if (searchButton) searchButton.disabled = true;

  chrome.runtime.sendMessage(
    {
      type: searchMode === 'smart' ? 'SMART_SEARCH' : 'SEARCH',
      query,
      filter
    },
    ({ ok, results: emails, error, code }) => {
      if (searchButton) searchButton.disabled = false;
      if (!ok) {
        results.replaceChildren();
        const message = document.createElement('p');
        message.className = 'summary-text';
        message.style.color = 'red';
        message.textContent = error || 'Search failed.';
        results.appendChild(message);
        if (code === 'AUTH_REQUIRED') renderConnection({ status: 'reauthentication_required' });
        return;
      }

      if (searchMode === 'smart') {
        renderSmartResults(results, emails || []);
        return;
      }

      if (!emails || emails.length === 0) {
        results.innerHTML = `<div class="output-placeholder"><p>No results found.</p></div>`;
        return;
      }

      results.innerHTML = emails.map(m => `
        <div class="result-item" ${m.web_link ? `data-url="${escapeHtml(m.web_link)}"` : ''} style="${m.web_link ? 'cursor:pointer' : ''}">
          <div class="result-meta">
            <span class="result-from">${escapeHtml(m.from_name || m.from || 'Unknown')}</span>
            <span class="result-date">${m.received ? formatDate(m.received) : ''}</span>
          </div>
          <div class="result-subject">${escapeHtml(m.subject)}</div>
          <div class="result-snippet">${escapeHtml(m.body_preview || '')}</div>
        </div>`
      ).join('');

      results.querySelectorAll('.result-item[data-url]').forEach(item => {
        item.addEventListener('click', () => {
          chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            chrome.tabs.update(tab.id, { url: item.dataset.url });
          });
        });
      });
    }
  );
});

function renderSmartResults(results, matches) {
  results.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'output-placeholder';
    const message = document.createElement('p');
    message.textContent = 'No strong matches found. Try adding a person, topic, or approximate date.';
    empty.appendChild(message);
    results.appendChild(empty);
    return;
  }
  matches.forEach((match) => {
    const item = document.createElement('div');
    item.className = 'result-item smart-result-item';
    if (match.web_link) {
      item.dataset.url = match.web_link;
      item.style.cursor = 'pointer';
    }

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const sender = document.createElement('span');
    sender.className = 'result-from';
    sender.textContent = match.from_name || match.from || 'Unknown';
    meta.append(sender);

    const subject = document.createElement('div');
    subject.className = 'result-subject';
    subject.textContent = match.subject || '(no subject)';
    const date = document.createElement('div');
    date.className = 'result-date';
    date.textContent = match.received ? formatDate(match.received) : '';
    const reason = document.createElement('div');
    reason.className = 'result-reason';
    reason.textContent = match.reason || 'Matches the search description.';
    const snippet = document.createElement('div');
    snippet.className = 'result-snippet';
    snippet.textContent = match.body_preview || '';
    item.append(meta, subject, date, reason, snippet);
    results.appendChild(item);
  });

  results.querySelectorAll('.result-item[data-url]').forEach(item => {
    item.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.tabs.update(tab.id, { url: item.dataset.url });
      });
    });
  });
}

// ── Q&A chat ────────────────────────────────────────────────────
  let qaSessionId = crypto.randomUUID();
  let qaIsNewSession = true;
  let qaEmailContent = '';
  const qaInput  = document.getElementById('qa-input');
  const qaBtn    = document.getElementById('btn-qa-send');
  const chatWin  = document.getElementById('chat-window');

  document.querySelector('[data-target="view-qa"]')?.addEventListener('click', () => {
    qaSessionId    = crypto.randomUUID();
    qaIsNewSession = true;
    qaEmailContent = '';
  });

  qaBtn?.addEventListener('click', sendQA);
  qaInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendQA();
  });

  function sendQA() {
    const text = qaInput?.value.trim();
    if (!text) return;

    appendBubble('user', text);
    qaInput.value = '';
    qaInput.disabled = true;
    qaBtn.disabled   = true;

    const thinking = appendBubble('assistant', '…');

    if (qaIsNewSession) {
      chrome.runtime.sendMessage({ type: 'GET_EMAIL_CONTENT' }, (contentResponse) => {
        qaEmailContent = contentResponse?.content || '';
        dispatchQA(text, thinking, qaEmailContent);
      })
    } else {
      dispatchQA(text, thinking, qaEmailContent);
    }
    }

  function dispatchQA(question, thinkingBubble, emailContent) {
    const payload = {
      type:         'QA',
      question,
      sessionId:    qaSessionId,
      isNewSession: qaIsNewSession,
    };
    if (emailContent) payload.emailContent = emailContent;

    chrome.runtime.sendMessage(payload, ({ ok, answer, error }) => {
      thinkingBubble.querySelector('.bubble-content').textContent = ok ? answer : `Error: ${error}`;
      chatWin.scrollTop = chatWin.scrollHeight;

      if (ok) qaIsNewSession = false;

      qaInput.disabled = false;
      qaBtn.disabled   = false;
      qaInput.focus();
    });
  }

  function appendBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    const content = document.createElement('div');
    content.className = 'bubble-content';
    content.textContent = text;
    bubble.appendChild(content);
    chatWin?.appendChild(bubble);
    chatWin.scrollTop = chatWin.scrollHeight;
    return bubble;
  }

  // ── Compose ─────────────────────────────────────────────────────
  document.getElementById('btn-compose')?.addEventListener('click', () => {
    const prompt      = document.getElementById('compose-prompt')?.value.trim();
    const tone        = document.querySelector('.tone-chips .filter-chip.active')?.dataset.tone || 'professional';
    const to          = document.getElementById('compose-to')?.value.trim();
    const sender_name = '';

    if (!prompt) return;

    const btn = document.getElementById('btn-compose');
    btn.textContent = 'Drafting…';
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { type: 'COMPOSE', prompt, tone, to, sender_name },
      ({ ok, draft, error }) => {
        btn.textContent = 'Draft Email';
        btn.disabled = false;
        if (ok) {
          document.getElementById('compose-subject').value = draft.subject;
          document.getElementById('compose-prompt').value  = draft.body;
          // Show the send button now that we have a draft
          document.getElementById('btn-send-email').hidden = false;
        } else {
          alert(`Compose failed: ${error}`);
        }
      }
    );
  });

  document.getElementById('btn-send-email')?.addEventListener('click', () => {
    const subject   = document.getElementById('compose-subject')?.value.trim();
    const body      = document.getElementById('compose-prompt')?.value.trim();
    const recipient = document.getElementById('compose-to')?.value.trim();

    if (!subject || !body || !recipient) {
      alert('Please fill in To, Subject, and body before sending.');
      return;
    }

    const btn = document.getElementById('btn-send-email');
    btn.textContent = 'Sending…';
    btn.disabled = true;

    chrome.runtime.sendMessage(
      { type: 'SEND', subject, body, recipient },
      ({ ok, error, code }) => {
        btn.textContent = 'Send Email';
        btn.disabled = false;
        if (ok) {
          // Clear the form on success
          document.getElementById('compose-to').value      = '';
          document.getElementById('compose-subject').value = '';
          document.getElementById('compose-prompt').value  = '';
          btn.hidden = true;
          alert('Email sent successfully!');
        } else {
          if (code === 'AUTH_REQUIRED') renderConnection({ status: 'reauthentication_required' });
          alert(`Send failed: ${error}`);
        }
      }
    );
  });

  // ── Helpers ─────────────────────────────────────────────────────
  function setLoading(el) {
    el.innerHTML = `<div class="output-placeholder">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

});
