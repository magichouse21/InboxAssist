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

  const activeChip = document.querySelector('#view-search .filter-chip.active');
  const filter = activeChip?.dataset.filter || 'all';

  if (!query) return;
  setLoading(results);

  chrome.runtime.sendMessage(
    {
      type: 'SEARCH',
      query,
      filter
    },
    ({ ok, results: emails, error }) => {
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








