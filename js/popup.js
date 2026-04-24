function showTab(name) {
  document.getElementById('view-main').style.display = 'none';
  document.querySelectorAll('.tab').forEach(tab => {
    tab.style.display = 'none';
  });

  if (name === 'main') {
    document.getElementById('view-main').style.display = 'block';
  } else {
    const tab = document.getElementById('view-' + name);
    if (tab) tab.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('open-summarize')?.addEventListener('click', () => showTab('summarize'));
  document.getElementById('open-search')?.addEventListener('click', () => showTab('search'));
  document.getElementById('open-qa')?.addEventListener('click', () => showTab('qa'));
  document.getElementById('open-compose')?.addEventListener('click', () => showTab('compose'));

  document.getElementById('back-from-summarize')?.addEventListener('click', () => showTab('main'));
  document.getElementById('back-from-search')?.addEventListener('click', () => showTab('main'));
  document.getElementById('back-from-qa')?.addEventListener('click', () => showTab('main'));
  document.getElementById('back-from-compose')?.addEventListener('click', () => showTab('main'));
});