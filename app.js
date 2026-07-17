/**
 * Zdravotní průvodce — main app
 *
 * Načítá data z window.__APP_DATA__ (bundlovaná v data-bundle.js)
 * Používá window.Storage a window.GeminiClient (definované v lib/*.js)
 */

(function() {

// ============================================================
// State
// ============================================================
let foodsDb = null;
let herbsDb = null;
let profileSeed = null;
let timelineSeed = null;
let shortcutsDb = null;

// Konverzační stav v záložce Otázka — v paměti, nepersistuje se přes reload.
// Historie se ukládá zvlášť do 📚 Historie.
let currentConversation = []; // [{role: 'user'|'model', text: '...'}, ...]

// ============================================================
// Bootstrap
// ============================================================
function init() {
  loadData();
  setupTabs();
  setupSettings();
  setupBackButton();
  setupDenik();
  setupOtazka();
  setupJidlo();
  setupZkratky();
  setupHistorie();
  setupProfil();
  initFirstRun();
  renderEntries();
  renderProfile();
  renderShortcuts();
  renderHistorie();
}

// ============================================================
// History helper — save every AI response
// ============================================================
function saveToHistory(type, icon, title, prompt, response) {
  Storage.addHistoryEntry({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    type,
    icon,
    title,
    prompt,
    response
  });
  // Re-render if user is viewing Historie tab
  if (document.getElementById('tab-historie').classList.contains('active')) {
    renderHistorie();
  }
}

// ============================================================
// Back button — clears output and scrolls to top
// ============================================================
function setupBackButton() {
  document.getElementById('btn-back').addEventListener('click', goBack);
}

function goBack() {
  ['otazka-output', 'jidlo-output', 'zkratky-output'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  // Ukončit i aktuální konverzaci v Otázce
  currentConversation = [];
  updateContinueButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateBackButton();
}

function updateBackButton() {
  const hasOutput = ['otazka-output', 'jidlo-output', 'zkratky-output'].some(id => {
    const el = document.getElementById(id);
    return el && el.innerHTML.trim().length > 0;
  });
  const btn = document.getElementById('btn-back');
  if (btn) btn.style.visibility = hasOutput ? 'visible' : 'hidden';
}

function loadData() {
  const D = window.__APP_DATA__;
  if (!D) {
    showError('Chyba: data-bundle.js se nenačetl. Otevři README a postupuj podle instrukcí.');
    return;
  }
  foodsDb = D.foods;
  herbsDb = D.herbs;
  profileSeed = D.profile;
  timelineSeed = D.timeline;
  shortcutsDb = D.shortcuts;

  // First run: seed profile and timeline
  if (!Storage.getProfile()) Storage.setProfile(profileSeed);
  if (!Storage.getTimeline().length) Storage.setTimeline(timelineSeed.events);
}

// ============================================================
// First run modal
// ============================================================
function initFirstRun() {
  if (!Storage.getApiKey()) {
    openSettings();
  }
}

// ============================================================
// Tabs
// ============================================================
function setupTabs() {
  const tabs = document.querySelectorAll('nav.tabs button');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ============================================================
// Settings modal
// ============================================================
function setupSettings() {
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

function openSettings() {
  document.getElementById('api-key').value = Storage.getApiKey() || '';
  document.getElementById('api-model').value = Storage.getModel();
  document.getElementById('modal-settings').classList.add('active');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('active');
}

function saveSettings() {
  const key = document.getElementById('api-key').value.trim();
  const model = document.getElementById('api-model').value;
  if (!key) {
    alert('API klíč nesmí být prázdný.');
    return;
  }
  Storage.setApiKey(key);
  Storage.setModel(model);
  closeSettings();
}

// ============================================================
// AI helper
// ============================================================
async function callAI(userPrompt, taskPrompt = null) {
  const apiKey = Storage.getApiKey();
  if (!apiKey) {
    openSettings();
    throw new Error('Zadej nejdřív API klíč v nastavení.');
  }
  const client = new GeminiClient(apiKey, Storage.getModel());
  const profile = Storage.getProfile();
  const entries = Storage.getEntries();
  const systemPrompt = buildSystemPrompt({
    profile,
    recentEntries: entries,
    foodsDb,
    herbsDb
  });
  const fullUserPrompt = taskPrompt ? `${taskPrompt}\n\n---\n\n${userPrompt}` : userPrompt;
  const text = await client.generate(
    [{ role: 'user', text: fullUserPrompt }],
    systemPrompt,
    { temperature: 0.55, maxOutputTokens: 4096 }
  );
  return text;
}

// ============================================================
// Markdown-to-HTML (jednoduché, dostatečné pro naše potřeby)
// ============================================================
function renderMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  html = html.replace(/(Možný návrh|Hypotéza|Domněnka):/g, '<span class="tag tag-suggestion">návrh</span>');

  html = html.replace(/^[\-•] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  html = html.split(/\n{2,}/).map(block => {
    if (block.startsWith('<') || block.trim() === '') return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

// ============================================================
// Deník
// ============================================================
function setupDenik() {
  document.getElementById('btn-save-entry').addEventListener('click', saveDenikEntry);
}

function saveDenikEntry() {
  const nalada = document.getElementById('denik-nalada').value.trim();
  const jidlo = document.getElementById('denik-jidlo').value.trim();
  const priznaky = document.getElementById('denik-priznaky').value.trim();

  if (!nalada && !jidlo && !priznaky) {
    alert('Záznam je prázdný.');
    return;
  }

  const entry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    nalada,
    jidlo,
    priznaky
  };

  Storage.addEntry(entry);

  document.getElementById('denik-nalada').value = '';
  document.getElementById('denik-jidlo').value = '';
  document.getElementById('denik-priznaky').value = '';

  renderEntries();
}

function renderEntries() {
  const entries = Storage.getEntries();
  const list = document.getElementById('denik-list');
  if (!entries.length) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">📓</div>
      <p>Zatím tu nic není. Uložte první záznam výše.</p>
    </div>`;
    return;
  }
  list.innerHTML = entries.slice(0, 20).map(e => {
    const d = new Date(e.date);
    const dateStr = d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <div class="card">
        <div class="card-header">
          <strong>${escapeHtml(e.nalada) || '(bez popisu nálady)'}</strong>
          <span class="card-date">${dateStr}</span>
        </div>
        ${e.jidlo ? `<p class="small"><strong>Jídlo:</strong> ${escapeHtml(e.jidlo)}</p>` : ''}
        ${e.priznaky ? `<p class="small"><strong>Příznaky:</strong> ${escapeHtml(e.priznaky)}</p>` : ''}
        <div class="flex flex-end mt-1">
          <button class="btn btn-secondary small" data-id="${e.id}" data-act="delete-entry">Smazat</button>
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('[data-act="delete-entry"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Smazat tento záznam?')) {
        Storage.deleteEntry(btn.dataset.id);
        renderEntries();
      }
    });
  });
}

// ============================================================
// Otázka + konverzační mód
// ============================================================
function setupOtazka() {
  document.getElementById('btn-analyze').addEventListener('click', () => runAnalysis('new'));
  document.getElementById('btn-continue').addEventListener('click', () => runAnalysis('continue'));
}

function updateContinueButton() {
  const btn = document.getElementById('btn-continue');
  if (!btn) return;
  btn.disabled = currentConversation.length === 0;
  btn.title = btn.disabled
    ? 'Nejdřív polož první otázku'
    : `Pokračovat v konverzaci (${currentConversation.filter(m => m.role === 'user').length} předchozích otázek)`;
}

async function runAnalysis(mode) {
  const textInput = document.getElementById('otazka-text');
  const text = textInput.value.trim();
  if (!text) {
    alert('Napiš svou otázku nebo problém.');
    return;
  }

  const output = document.getElementById('otazka-output');
  const btnNew = document.getElementById('btn-analyze');
  const btnCont = document.getElementById('btn-continue');

  // Reset conversation for a new question
  if (mode === 'new' || currentConversation.length === 0) {
    currentConversation = [];
    mode = 'new';
  }

  // Optimisticky přidat uživatelskou zprávu do konverzace (pro průběžný render)
  currentConversation.push({ role: 'user', text });

  // Sestavit API zprávy
  let apiMessages;
  if (mode === 'new') {
    // Nová otázka — první zpráva obalená analytickým promptem pro strukturovanou odpověď
    apiMessages = [{
      role: 'user',
      text: `${buildAnalyzePrompt(text)}\n\n---\n\n${text}`
    }];
  } else {
    // Pokračování — pošli celou konverzaci jako přirozený dialog.
    // První uživatelskou zprávu ve výchozím kontextu ponecháme bez wrappingu
    // (AI má strukturální instrukce v systémovém promptu).
    apiMessages = currentConversation.map(m => ({ role: m.role, text: m.text }));
  }

  // Vykresli konverzaci + loading
  renderConversation(true);
  btnNew.disabled = true;
  btnCont.disabled = true;
  updateBackButton();

  try {
    const apiKey = Storage.getApiKey();
    if (!apiKey) {
      openSettings();
      throw new Error('Zadej nejdřív API klíč v nastavení.');
    }
    const client = new GeminiClient(apiKey, Storage.getModel());
    const systemPrompt = buildSystemPrompt({
      profile: Storage.getProfile(),
      recentEntries: Storage.getEntries(),
      foodsDb,
      herbsDb
    });
    const response = await client.generate(apiMessages, systemPrompt, {
      temperature: 0.55,
      maxOutputTokens: 4096
    });

    currentConversation.push({ role: 'model', text: response });
    renderConversation(false);

    saveToHistory(
      'otazka',
      mode === 'new' ? '💭' : '🔗',
      (mode === 'new' ? '' : '[pokračování] ') + text.slice(0, 80),
      text,
      response
    );

    textInput.value = '';
  } catch (e) {
    // Vrátit poslední uživatelskou zprávu zpět (nezobrazovat ji jako "odeslanou")
    currentConversation.pop();
    renderConversation(false);
    // Zobraz chybu pod konverzací
    output.insertAdjacentHTML('beforeend', `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`);
  } finally {
    btnNew.disabled = false;
    updateContinueButton();
    updateBackButton();
  }
}

function renderConversation(showLoading = false) {
  const output = document.getElementById('otazka-output');
  if (currentConversation.length === 0 && !showLoading) {
    output.innerHTML = '';
    return;
  }

  const turnsHtml = currentConversation.map((msg) => {
    if (msg.role === 'user') {
      return `<div class="turn-user">
        <div class="turn-label">🙋 TY</div>
        <div>${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
      </div>`;
    } else {
      return `<div class="turn-ai card">
        <div class="turn-label">🌿 AI</div>
        ${renderMarkdown(msg.text)}
      </div>`;
    }
  }).join('');

  const loadingHtml = showLoading
    ? `<div class="turn-ai card"><div class="turn-label">🌿 AI</div><div class="loading">Přemýšlím</div></div>`
    : '';

  output.innerHTML = turnsHtml + loadingHtml;
}

// ============================================================
// Jídlo & Byliny
// ============================================================
function setupJidlo() {
  document.getElementById('btn-lookup').addEventListener('click', () => doLookup());
  document.getElementById('btn-combine').addEventListener('click', doCombineCheck);
}

function findInDb(query, db, key) {
  if (!db) return null;
  const q = query.toLowerCase().trim();
  return db[key].find(item =>
    item.name.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    (item.aliases || []).some(a => a.toLowerCase().includes(q))
  ) || null;
}

async function doLookup() {
  const query = document.getElementById('jidlo-text').value.trim();
  if (!query) {
    alert('Zadej potravinu nebo bylinu.');
    return;
  }
  const output = document.getElementById('jidlo-output');
  const btn = document.getElementById('btn-lookup');
  output.innerHTML = '<div class="loading">Vyhledávám</div>';
  btn.disabled = true;
  updateBackButton();
  try {
    const food = findInDb(query, foodsDb, 'foods');
    const herb = findInDb(query, herbsDb, 'herbs');

    let taskPrompt;
    if (herb) {
      taskPrompt = buildHerbLookupPrompt(query, Storage.getProfile(), herb);
    } else if (food) {
      taskPrompt = buildFoodLookupPrompt(query, Storage.getProfile(), food);
    } else {
      taskPrompt = buildFoodLookupPrompt(query, Storage.getProfile(), null);
    }

    const response = await callAI(query, taskPrompt);

    let dbInfo = '';
    if (food || herb) {
      const item = food || herb;
      dbInfo = `<div class="small muted mb-1">📚 Nalezeno v databázi: <strong>${escapeHtml(item.name)}</strong> ${item.aliases?.length ? `(${escapeHtml(item.aliases.join(', '))})` : ''}</div>`;
    } else {
      dbInfo = `<div class="small muted mb-1">📚 Není v lokální databázi — AI použila své obecné znalosti.</div>`;
    }

    output.innerHTML = `${dbInfo}<div class="card">${renderMarkdown(response)}</div>`;
    const type = herb ? '🌿 Bylina' : '🥗 Jídlo';
    saveToHistory('jidlo-lookup', '🥗', `${type}: ${query}`, query, response);
    document.getElementById('jidlo-text').value = '';
  } catch (e) {
    output.innerHTML = `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    updateBackButton();
  }
}

async function doCombineCheck() {
  const query = document.getElementById('jidlo-text').value.trim();
  if (!query) {
    alert('Zadej alespoň 2 položky oddělené čárkou (např. „mléko, ovoce")');
    return;
  }
  const items = query.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if (items.length < 2) {
    alert('Pro kontrolu kombinace zadej alespoň 2 položky oddělené čárkou.');
    return;
  }
  const output = document.getElementById('jidlo-output');
  const btn = document.getElementById('btn-combine');
  output.innerHTML = '<div class="loading">Kontroluji kombinaci</div>';
  btn.disabled = true;
  updateBackButton();
  try {
    const taskPrompt = buildCombineCheckPrompt(items, Storage.getProfile());
    const response = await callAI(items.join(' + '), taskPrompt);
    output.innerHTML = `<div class="card">${renderMarkdown(response)}</div>`;
    saveToHistory('jidlo-combine', '🥣', `Kombinace: ${items.join(', ')}`, items.join(' + '), response);
    document.getElementById('jidlo-text').value = '';
  } catch (e) {
    output.innerHTML = `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    updateBackButton();
  }
}

// ============================================================
// Zkratky
// ============================================================
function setupZkratky() {
  document.getElementById('btn-save-zkratka').addEventListener('click', saveCustomShortcut);
}

function renderShortcuts() {
  const builtinEl = document.getElementById('zkratky-vestavene');
  const customEl = document.getElementById('zkratky-vlastni');

  const builtin = shortcutsDb?.builtin || [];
  const custom = Storage.getCustomShortcuts();

  builtinEl.innerHTML = builtin.map(s => renderShortcutCard(s, false)).join('');

  if (custom.length === 0) {
    customEl.innerHTML = `<p class="muted small">Zatím žádné vlastní. Přidej si vlastní zkratku níže.</p>`;
  } else {
    customEl.innerHTML = custom.map(s => renderShortcutCard(s, true)).join('');
  }

  // Bind click handlers
  document.querySelectorAll('[data-shortcut-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger if delete button was clicked
      if (e.target.closest('[data-act="delete-shortcut"]')) return;
      const id = el.dataset.shortcutId;
      const isCustom = el.dataset.custom === 'true';
      runShortcut(id, isCustom);
    });
  });

  document.querySelectorAll('[data-act="delete-shortcut"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('Smazat tuto zkratku?')) {
        Storage.deleteCustomShortcut(id);
        renderShortcuts();
      }
    });
  });
}

function renderShortcutCard(s, isCustom) {
  const deleteBtn = isCustom
    ? `<button class="icon-btn" data-act="delete-shortcut" data-id="${escapeHtml(s.id)}" title="Smazat" style="font-size:1rem;padding:.15rem .4rem;">🗑</button>`
    : '';
  return `
    <div class="card shortcut-card" data-shortcut-id="${escapeHtml(s.id)}" data-custom="${isCustom}" style="cursor:pointer;transition:transform .1s,box-shadow .1s;">
      <div class="card-header">
        <strong style="font-size:1.05rem;">${escapeHtml(s.icon || '⚡')} ${escapeHtml(s.title)}</strong>
        ${deleteBtn}
      </div>
      ${s.description ? `<p class="small muted" style="margin:0;">${escapeHtml(s.description)}</p>` : ''}
    </div>
  `;
}

async function runShortcut(id, isCustom) {
  const source = isCustom ? Storage.getCustomShortcuts() : (shortcutsDb?.builtin || []);
  const shortcut = source.find(s => s.id === id);
  if (!shortcut) {
    alert('Zkratka nenalezena.');
    return;
  }

  // Detect placeholders like [ZDE POPIŠ SVOU KOMBINACI] or [ZDE POPIŠ]
  // and ask user for input before running.
  let finalPrompt = shortcut.prompt;
  const placeholderPattern = /\[([^\]]{3,})\]/g;
  const matches = [...shortcut.prompt.matchAll(placeholderPattern)];

  if (matches.length > 0) {
    for (const match of matches) {
      const fullPlaceholder = match[0];
      const label = match[1];
      const userInput = window.prompt(
        `${shortcut.title}\n\n${label}\n\n(Napiš text a klikni OK):`,
        ''
      );
      if (userInput === null) {
        return; // user cancelled
      }
      if (!userInput.trim()) {
        alert('Nezadal(a) jsi žádný text. Zkratka nespuštěna.');
        return;
      }
      finalPrompt = finalPrompt.replace(fullPlaceholder, userInput.trim());
    }
  }

  const output = document.getElementById('zkratky-output');
  output.innerHTML = `<div class="card"><div class="loading">Zpracovávám "${escapeHtml(shortcut.title)}"</div></div>`;
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateBackButton();

  try {
    const response = await callAI(finalPrompt);
    output.innerHTML = `
      <div class="card">
        <div class="card-header">
          <strong>${escapeHtml(shortcut.icon || '⚡')} ${escapeHtml(shortcut.title)}</strong>
          <span class="card-date">${new Date().toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}</span>
        </div>
        ${renderMarkdown(response)}
      </div>
    `;
    saveToHistory('zkratka', shortcut.icon || '⚡', shortcut.title, finalPrompt, response);
  } catch (e) {
    output.innerHTML = `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`;
  } finally {
    updateBackButton();
  }
}

function saveCustomShortcut() {
  const icon = document.getElementById('zkratka-icon').value.trim() || '⚡';
  const title = document.getElementById('zkratka-title').value.trim();
  const description = document.getElementById('zkratka-desc').value.trim();
  const prompt = document.getElementById('zkratka-prompt').value.trim();

  if (!title) {
    alert('Zadej název zkratky.');
    return;
  }
  if (!prompt) {
    alert('Zadej prompt (co má AI dělat).');
    return;
  }

  const shortcut = {
    id: 'custom-' + Date.now(),
    icon,
    title,
    description,
    prompt,
    createdAt: new Date().toISOString()
  };

  Storage.addCustomShortcut(shortcut);

  // Clear form
  document.getElementById('zkratka-icon').value = '';
  document.getElementById('zkratka-title').value = '';
  document.getElementById('zkratka-desc').value = '';
  document.getElementById('zkratka-prompt').value = '';

  renderShortcuts();
  alert('Zkratka uložena. ✓');
}

// ============================================================
// Historie
// ============================================================
function setupHistorie() {
  document.getElementById('btn-clear-historie').addEventListener('click', clearHistoryAll);
  document.getElementById('historie-hledat').addEventListener('input', renderHistorie);
}

function normalizeText(s) {
  // Odstraní diakritiku a převede na malá písmena.
  // "migréna" → "migrena", "Ženšen" → "zensen"
  // Rozsah U+0300–U+036F pokrývá všechny kombinovací diakritické znaky.
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchesSearch(text, rawQuery) {
  // Chytré vyhledávání s podporou českých pádů.
  // 1. Přímá shoda po odstranění diakritiky
  // 2. Postupně zkracuje dotaz o 1-4 znaky (české koncovky pádů)
  //    tak, aby "aplikace" našlo "aplikaci", "ženšen" našlo "ženšenu" atd.
  const q = normalizeText(rawQuery.trim());
  if (!q) return true;
  const t = normalizeText(text);

  if (t.includes(q)) return true;

  // Zkus kratší stem (min 3 znaky, aby to nebylo příliš benevolentní)
  for (let i = 1; i <= 4; i++) {
    if (q.length - i >= 3 && t.includes(q.slice(0, -i))) return true;
  }
  return false;
}

function renderHistorie() {
  const container = document.getElementById('historie-list');
  const query = (document.getElementById('historie-hledat').value || '').trim();

  let entries = Storage.getHistory();

  if (query) {
    entries = entries.filter(e =>
      matchesSearch(e.title, query) ||
      matchesSearch(e.prompt, query) ||
      matchesSearch(e.response, query)
    );
  }

  if (entries.length === 0) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">📚</div>
      <p>${query ? 'Nic nenalezeno.' : 'Zatím tu nic není. Až se zeptáš na Otázku, Jídlo nebo klikneš na Zkratku, odpověď se sem uloží.'}</p>
    </div>`;
    return;
  }

  container.innerHTML = entries.map(e => {
    const d = new Date(e.timestamp);
    const dateStr = d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <details class="card history-item" style="margin-bottom:.5rem;">
        <summary style="cursor:pointer;list-style:none;">
          <div class="card-header" style="margin:0;">
            <span><strong>${escapeHtml(e.icon || '⚡')} ${escapeHtml(e.title)}</strong></span>
            <span class="card-date">${dateStr}</span>
          </div>
        </summary>
        <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border);">
          <p class="small muted mb-1"><strong>Dotaz:</strong> ${escapeHtml(e.prompt.slice(0, 300))}${e.prompt.length > 300 ? '…' : ''}</p>
          <div style="margin-top:.5rem;">${renderMarkdown(e.response)}</div>
          <div class="flex flex-end mt-1">
            <button class="btn btn-secondary small" data-hist-del="${escapeHtml(e.id)}" style="font-size:.85rem;">🗑 Smazat záznam</button>
          </div>
        </div>
      </details>
    `;
  }).join('');

  container.querySelectorAll('[data-hist-del]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.histDel;
      if (confirm('Smazat tento záznam z historie?')) {
        Storage.deleteHistoryEntry(id);
        renderHistorie();
      }
    });
  });
}

function clearHistoryAll() {
  if (Storage.getHistory().length === 0) {
    alert('Historie je už prázdná.');
    return;
  }
  if (confirm('Opravdu smazat CELOU historii? Toto nelze vrátit zpět.')) {
    Storage.clearHistory();
    renderHistorie();
  }
}

// ============================================================
// Profil
// ============================================================
function setupProfil() {
  document.getElementById('btn-edit-profile').addEventListener('click', openProfileEditor);
  document.getElementById('btn-cancel-profile').addEventListener('click', closeProfileEditor);
  document.getElementById('btn-save-profile').addEventListener('click', saveProfileFromEditor);
  document.getElementById('btn-export').addEventListener('click', exportData);
}

function renderProfile() {
  const p = Storage.getProfile();
  const container = document.getElementById('profil-content');
  if (!p) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">👤</div><p>Profil zatím nenastaven.</p></div>';
    return;
  }
  const sections = [];

  if (p.basic) {
    sections.push(`
      <div class="profile-section">
        <h3>Základní</h3>
        <div class="profile-item"><span class="key">Jméno</span><span>${escapeHtml(p.basic.name)}</span></div>
        <div class="profile-item"><span class="key">Věk</span><span>${escapeHtml(String(p.basic.age))}</span></div>
        <div class="profile-item"><span class="key">Lokalita</span><span>${escapeHtml(p.basic.location)}</span></div>
      </div>
    `);
  }

  if (p.ayurveda) {
    const a = p.ayurveda;
    sections.push(`
      <div class="profile-section">
        <h3>Ájurvéda</h3>
        ${a.prakriti ? `<div class="profile-item"><span class="key">Prakriti</span><span>${escapeHtml(a.prakriti)}</span></div>` : ''}
        ${a.vikriti ? `<div class="profile-item"><span class="key">Vikriti</span><span>${escapeHtml(a.vikriti)}</span></div>` : ''}
        ${a.agni ? `<div class="profile-item"><span class="key">Agni</span><span>${escapeHtml(a.agni)}</span></div>` : ''}
        ${a.ama ? `<div class="profile-item"><span class="key">Ama</span><span>${escapeHtml(a.ama)}</span></div>` : ''}
      </div>
    `);
  }

  if (p.tcm) {
    sections.push(`
      <div class="profile-section">
        <h3>TCM</h3>
        ${p.tcm.mainPattern ? `<div class="profile-item"><span class="key">Hlavní vzorec</span><span>${escapeHtml(p.tcm.mainPattern)}</span></div>` : ''}
        ${p.tcm.secondaryPatterns ? `<p class="small mt-1">${p.tcm.secondaryPatterns.map(escapeHtml).join('<br>')}</p>` : ''}
      </div>
    `);
  }

  if (p.symptoms?.current?.length) {
    sections.push(`
      <div class="profile-section">
        <h3>Aktuální příznaky</h3>
        <ul>${p.symptoms.current.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
      </div>
    `);
  }

  if (p.redFlags?.length) {
    sections.push(`
      <div class="profile-section">
        <h3>⚠️ Red flags</h3>
        <div class="disclaimer">${p.redFlags.map(escapeHtml).join('<br><br>')}</div>
      </div>
    `);
  }

  if (p.currentSupplements?.haveAtHome?.length) {
    sections.push(`
      <div class="profile-section">
        <h3>Doplňky doma</h3>
        <p class="small">${p.currentSupplements.haveAtHome.map(escapeHtml).join(' • ')}</p>
      </div>
    `);
  }

  container.innerHTML = sections.join('');
}

function openProfileEditor() {
  document.getElementById('profile-json').value = JSON.stringify(Storage.getProfile(), null, 2);
  document.getElementById('modal-profile').classList.add('active');
}

function closeProfileEditor() {
  document.getElementById('modal-profile').classList.remove('active');
}

function saveProfileFromEditor() {
  try {
    const p = JSON.parse(document.getElementById('profile-json').value);
    Storage.setProfile(p);
    closeProfileEditor();
    renderProfile();
  } catch (e) {
    alert('Neplatný JSON: ' + e.message);
  }
}

function exportData() {
  const data = {
    profile: Storage.getProfile(),
    entries: Storage.getEntries(),
    timeline: Storage.getTimeline(),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zdravi-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Utilities
// ============================================================
function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showError(msg) {
  const main = document.querySelector('main');
  if (main) {
    main.insertAdjacentHTML('afterbegin', `<div class="disclaimer"><strong>⚠️</strong> ${escapeHtml(msg)}</div>`);
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
