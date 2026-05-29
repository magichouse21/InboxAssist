/* ── InboxAssist popup.js ── */

document.addEventListener('DOMContentLoaded', () => {

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
        output.innerHTML = ok
          ? `<p class="summary-text">${result}</p>`
          : `<p class="summary-text" style="color:red">${error}</p>`;
      }
    );
  });

  // ── Search ──────────────────────────────────────────────────────
  document.getElementById('btn-search')?.addEventListener('click', () => {
    const query   = document.getElementById('search-input')?.value.trim();
    const results = document.getElementById('search-results');
    if (!query) return;
    setLoading(results);

    chrome.runtime.sendMessage({ type: 'SEARCH', query }, ({ ok, results: emails, error }) => {
      if (!ok) {
        results.innerHTML = `<p class="summary-text" style="color:red">${error}</p>`;
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

    // make results clickable
    results.querySelectorAll('.result-item[data-url]').forEach(item => {
      item.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          chrome.tabs.update(tab.id, { url: item.dataset.url });
        });
        
      });
    });
    });
  });

  // ── Q&A chat ────────────────────────────────────────────────────
  let qaSessionId = crypto.randomUUID();
  let qaIsNewSession = true;
  const qaInput  = document.getElementById('qa-input');
  const qaBtn    = document.getElementById('btn-qa-send');
  const chatWin  = document.getElementById('chat-window');

  document.querySelector('[data-target="view-qa"]')?.addEventListener('click', () => {
    qaSessionId    = crypto.randomUUID();
    qaIsNewSession = true;
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
        const emailContent = contentResponse?.content || '';
        dispatchQA(text, thinking, emailContent);
      });
    } else {
      dispatchQA(text, thinking, null);
    }
  }

  function dispatchQA(question, thinkingBubble, emailContent) {
    const payload = {
      type:         'QA',
      question,
      sessionId:    qaSessionId,
      isNewSession: qaIsNewSession,
    };
    if (qaIsNewSession && emailContent) payload.emailContent = emailContent;

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
    bubble.innerHTML = `<div class="bubble-content">${text}</div>`;
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
      ({ ok, error }) => {
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