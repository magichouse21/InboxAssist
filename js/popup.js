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

    // TODO: call background.js -> query Outlook Graph API / Claude
    setTimeout(() => {
      results.innerHTML = `
        <div class="result-item">
          <div class="result-meta">
            <span class="result-from">Sarah Chen</span>
            <span class="result-date">Apr 28</span>
          </div>
          <div class="result-subject">Re: Q3 Budget Review — Action Items</div>
          <div class="result-snippet">…the breakdown you requested is attached…</div>
        </div>
        <div class="result-item">
          <div class="result-meta">
            <span class="result-from">Marcus Webb</span>
            <span class="result-date">Apr 26</span>
          </div>
          <div class="result-subject">Design assets ready for review</div>
          <div class="result-snippet">…assets uploaded to the shared drive…</div>
        </div>`;
    }, 1000);
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

    chrome.runtime.sendMessage(
      {
        type:         'QA',
        question:     text,
        sessionId:    qaSessionId,
        isNewSession: qaIsNewSession,
      },
      ({ ok, answer, error }) => {
        thinking.querySelector('.bubble-content').textContent = ok ? answer : `Error: ${error}`;
        chatWin.scrollTop = chatWin.scrollHeight;

        if (ok) {
          qaIsNewSession = false; // subsequent turns reuse the same session
        }

        qaInput.disabled = false;
        qaBtn.disabled   = false;
        qaInput.focus();
      }
    );
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
    const sender_name = ''; // optionally add a field for this

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
        } else {
          alert(`Compose failed: ${error}`);
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

});