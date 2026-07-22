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

// Konverzační stav v záložce Otázka.
// currentConversation = pole zpráv: {role: 'user'|'model', text: string, image?: {data: base64, mimeType: string}}
// currentConversationId = ID uložené konverzace (pokud existuje) nebo null pro novou.
let currentConversation = [];
let currentConversationId = null;
let pendingImage = null; // {data: base64 (bez prefixu), mimeType: string, dataUrl: string}

// Mapa odpovědí připravených k uložení jako recept.
// Klíč = unikátní ID, hodnota = text odpovědi.
const responsesForSaving = new Map();
let responseIdCounter = 0;

// Sync (Supabase) — inicializuje se v init()
let syncClient = null;
let syncManager = null;

function registerResponseForSaving(text) {
  const id = 'resp-' + (++responseIdCounter);
  responsesForSaving.set(id, text);
  return id;
}

function makeSaveRecipeButton(responseText) {
  const id = registerResponseForSaving(responseText);
  return `<div class="flex flex-end mt-1"><button class="btn btn-secondary small" data-save-recipe-id="${id}" style="font-size:.85rem;">💾 Uložit jako recept</button></div>`;
}

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
  setupRecepty();
  setupProfil();
  setupRecipeModal();
  setupSaveRecipeDelegation();
  setupSync();
  initFirstRun();
  renderEntries();
  renderProfile();
  renderShortcuts();
  renderHistorie();
  renderRecepty();
  // Sync na startu — pokud je nastavené, stáhne data z cloudu
  bootstrapSync();
}

// ============================================================
// Sync (Supabase) — synchronizace mezi zařízeními
// ============================================================
function setupSync() {
  document.getElementById('btn-generate-userid').addEventListener('click', generateSyncUserId);
  document.getElementById('btn-test-sync').addEventListener('click', testSyncConnection);
  document.getElementById('btn-pull-now').addEventListener('click', pullFromCloudManual);
  document.getElementById('btn-push-now').addEventListener('click', pushToCloudManual);

  // Nastavit callback ze Storage, aby se posílalo do cloudu při každé změně
  Storage.setSyncCallback((key, value) => {
    if (syncManager && syncClient?.enabled) {
      syncManager.schedule(key, value);
    }
  });
}

function generateSyncUserId() {
  const id = 'zuzana-' + (crypto.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36))).slice(0, 12);
  document.getElementById('sync-userid').value = id;
  showSyncMessage(`Vygenerován ID: ${id}. Zkopíruj si ho, budeš ho potřebovat na druhém zařízení.`, 'info');
}

function initSyncClient(config) {
  syncClient = new SupabaseSync(config);
  syncManager = new SyncManager(syncClient);
  syncClient.onChange(updateSyncStatusIndicator);
}

function updateSyncStatusIndicator(sync) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (!sync.enabled) {
    el.textContent = '';
    el.title = 'Sync není nastavený';
    return;
  }
  switch (sync.status) {
    case 'syncing':
      el.textContent = '⏳';
      el.title = 'Synchronizuji…';
      break;
    case 'success':
      el.textContent = '☁️';
      el.title = `Synchronizováno ${sync.lastSync ? sync.lastSync.toLocaleTimeString('cs-CZ') : ''}`;
      break;
    case 'error':
      el.textContent = '⚠️';
      el.title = `Chyba synchronizace: ${sync.lastError || 'neznámá'}`;
      break;
    default:
      el.textContent = '☁';
      el.title = 'Sync připraven';
  }
}

async function bootstrapSync() {
  const cfg = Storage.getSyncConfig();
  if (!cfg?.url || !cfg?.apiKey || !cfg?.userId) return;

  initSyncClient(cfg);
  if (!syncClient.enabled) return;

  // Pull z cloudu na startu — pokud jsou tam data, přepíšou lokální
  try {
    syncClient._setStatus('syncing');
    const cloud = await syncClient.pullAll();
    let pulledAny = false;
    for (const [key, value] of Object.entries(cloud)) {
      if (Storage.isSyncKey(key) && value != null) {
        Storage.setLocal(key, value);
        pulledAny = true;
      }
    }
    syncClient._setStatus('success');
    // Pokud jsme něco stáhli, přerender všechno co je viditelné
    if (pulledAny) {
      renderEntries();
      renderProfile();
      renderShortcuts();
      renderHistorie();
      renderRecepty();
    }
  } catch (e) {
    console.error('Sync pull failed:', e);
    syncClient._setStatus('error', e.message);
  }
}

async function testSyncConnection() {
  const cfg = collectSyncFormValues();
  if (!cfg.url || !cfg.apiKey) {
    showSyncMessage('Vyplň URL a klíč.', 'error');
    return;
  }
  const testClient = new SupabaseSync(cfg);
  showSyncMessage('Testuji spojení…', 'info');
  const ok = await testClient.ping();
  if (ok) {
    showSyncMessage('✅ Spojení funguje! Klikni "Uložit" v nastavení.', 'success');
  } else {
    showSyncMessage(`❌ Nepodařilo se spojit: ${testClient.lastError || 'zkontroluj URL a klíč'}`, 'error');
  }
}

async function pullFromCloudManual() {
  if (!syncClient?.enabled) {
    showSyncMessage('Nejdřív ulož nastavení sync (klikni Uložit dole).', 'error');
    return;
  }
  if (!confirm('Stáhnout data z cloudu? Přepíše to tvá lokální data. Ujisti se, že chceš to.')) return;

  showSyncMessage('Stahuji z cloudu…', 'info');
  try {
    syncClient._setStatus('syncing');
    const cloud = await syncClient.pullAll();
    for (const [key, value] of Object.entries(cloud)) {
      if (Storage.isSyncKey(key) && value != null) {
        Storage.setLocal(key, value);
      }
    }
    syncClient._setStatus('success');
    renderEntries();
    renderProfile();
    renderShortcuts();
    renderHistorie();
    renderRecepty();
    showSyncMessage(`✅ Staženo ${Object.keys(cloud).length} typů dat z cloudu.`, 'success');
  } catch (e) {
    syncClient._setStatus('error', e.message);
    showSyncMessage(`❌ Stahování selhalo: ${e.message}`, 'error');
  }
}

async function pushToCloudManual() {
  if (!syncClient?.enabled) {
    showSyncMessage('Nejdřív ulož nastavení sync (klikni Uložit dole).', 'error');
    return;
  }
  showSyncMessage('Nahrávám do cloudu…', 'info');
  try {
    syncClient._setStatus('syncing');
    const keys = ['profile', 'entries', 'recipes', 'conversations', 'customShortcuts', 'history'];
    for (const key of keys) {
      const data = Storage.get(key);
      if (data != null) {
        await syncClient.push(key, data);
      }
    }
    syncClient._setStatus('success');
    showSyncMessage('✅ Data nahrána do cloudu.', 'success');
  } catch (e) {
    syncClient._setStatus('error', e.message);
    showSyncMessage(`❌ Nahrávání selhalo: ${e.message}`, 'error');
  }
}

function collectSyncFormValues() {
  return {
    url: document.getElementById('sync-url').value.trim(),
    apiKey: document.getElementById('sync-key').value.trim(),
    userId: document.getElementById('sync-userid').value.trim()
  };
}

function showSyncMessage(msg, type = 'info') {
  const el = document.getElementById('sync-message');
  if (!el) return;
  const colors = {
    info: 'var(--text-soft)',
    success: 'var(--accent-deep)',
    error: 'var(--danger)'
  };
  el.style.color = colors[type] || colors.info;
  el.textContent = msg;
}

// Delegace kliknutí na "💾 Uložit jako recept" tlačítka
function setupSaveRecipeDelegation() {
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-save-recipe-id]');
    if (!btn) return;
    const id = btn.dataset.saveRecipeId;
    const text = responsesForSaving.get(id);
    if (text) openSaveRecipeModal(text);
  });
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
  ['jidlo-output', 'zkratky-output'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  // Konverzaci v Otázce nejdřív uložit, pak vyčistit stav a zobrazení
  if (currentConversation.length > 0) {
    persistCurrentConversation();
  }
  currentConversation = [];
  currentConversationId = null;
  pendingImage = null;
  hideImagePreview();
  const otazkaOutput = document.getElementById('otazka-output');
  if (otazkaOutput) otazkaOutput.innerHTML = '';
  const otazkaText = document.getElementById('otazka-text');
  if (otazkaText) otazkaText.value = '';
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
  // Sync config
  const cfg = Storage.getSyncConfig();
  document.getElementById('sync-url').value = cfg.url || '';
  document.getElementById('sync-key').value = cfg.apiKey || '';
  document.getElementById('sync-userid').value = cfg.userId || '';
  showSyncMessage('', 'info');
  document.getElementById('modal-settings').classList.add('active');
}

function closeSettings() {
  document.getElementById('modal-settings').classList.remove('active');
}

async function saveSettings() {
  const key = document.getElementById('api-key').value.trim();
  const model = document.getElementById('api-model').value;
  if (!key) {
    alert('API klíč nesmí být prázdný.');
    return;
  }
  Storage.setApiKey(key);
  Storage.setModel(model);

  // Sync config
  const syncCfg = collectSyncFormValues();
  Storage.setSyncConfig(syncCfg);

  if (syncCfg.url && syncCfg.apiKey && syncCfg.userId) {
    initSyncClient(syncCfg);
    // Každé Uložit provede skutečný sync:
    // - Nejdřív se zeptej cloudu, co tam je
    // - Cloud MÁ data → stáhni (druhé zařízení nebo obnovení)
    // - Cloud NEMÁ data → nahraj lokální (první zařízení)
    try {
      syncClient._setStatus('syncing');
      const cloud = await syncClient.pullAll();
      const cloudKeys = Object.keys(cloud).filter(k => cloud[k] != null);

      if (cloudKeys.length > 0) {
        for (const key of cloudKeys) {
          if (Storage.isSyncKey(key)) {
            Storage.setLocal(key, cloud[key]);
          }
        }
        renderEntries();
        renderProfile();
        renderShortcuts();
        renderHistorie();
        renderRecepty();
        syncClient._setStatus('success');
        alert(`✅ Sync aktivní. Cloud měl data (${cloudKeys.length} typů), stáhla jsem je do tohoto zařízení.`);
      } else {
        const keys = ['profile', 'entries', 'recipes', 'conversations', 'customShortcuts', 'history'];
        let pushedAny = false;
        for (const k of keys) {
          const data = Storage.get(k);
          const hasContent = data != null && (
            (Array.isArray(data) && data.length > 0) ||
            (typeof data === 'object' && Object.keys(data).length > 0)
          );
          if (hasContent) {
            await syncClient.push(k, data);
            pushedAny = true;
          }
        }
        syncClient._setStatus('success');
        if (pushedAny) {
          alert('✅ Sync aktivní. Cloud byl prázdný, nahrála jsem tvá lokální data. Na dalším zařízení použij stejné údaje — automaticky se stáhne.');
        } else {
          alert('✅ Sync aktivní. Cloud i lokál jsou prozatím prázdné — synchronizace poběží až od prvních zápisů.');
        }
      }
    } catch (e) {
      syncClient._setStatus('error', e.message);
      alert(`Sync se nepodařilo spustit: ${e.message}`);
    }
  } else {
    syncClient = null;
    syncManager = null;
    updateSyncStatusIndicator({ enabled: false, status: 'disabled' });
  }

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
  const systemPrompt = buildSystemPrompt({
    profile: Storage.getProfile(),
    recentEntries: Storage.getEntries(),
    recipes: Storage.getRecipes(),
    historyItems: Storage.getHistory(),
    foodsDb,
    herbsDb
  });
  const fullUserPrompt = taskPrompt ? `${taskPrompt}\n\n---\n\n${userPrompt}` : userPrompt;
  const text = await client.generate(
    [{ role: 'user', text: fullUserPrompt }],
    systemPrompt,
    {
      temperature: 0.55,
      maxOutputTokens: 4096,
      onRetry: (attempt, total) => {
        // Volitelně: informuj uživatele o pokusu (přes globální notifikaci)
        console.log(`Retry ${attempt}/${total} po chybě spojení nebo přetížení`);
      }
    }
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
// Otázka + konverzační mód + obrázky
// ============================================================
function setupOtazka() {
  document.getElementById('btn-analyze').addEventListener('click', () => runAnalysis('new'));
  document.getElementById('btn-continue').addEventListener('click', () => runAnalysis('continue'));
  document.getElementById('btn-reset-conv').addEventListener('click', resetConversation);
  document.getElementById('btn-history-conv').addEventListener('click', openConversationsList);
  document.getElementById('btn-close-conv-list').addEventListener('click', () => {
    document.getElementById('modal-conv-list').classList.remove('active');
  });
  document.getElementById('image-input').addEventListener('change', onImagePicked);
  document.getElementById('btn-remove-image').addEventListener('click', removePendingImage);
}

function updateContinueButton() {
  const btnCont = document.getElementById('btn-continue');
  const btnReset = document.getElementById('btn-reset-conv');
  if (!btnCont) return;
  btnCont.disabled = currentConversation.length === 0;
  btnCont.title = btnCont.disabled
    ? 'Nejdřív polož první otázku'
    : `Pokračovat v konverzaci (${currentConversation.filter(m => m.role === 'user').length} otázek)`;
  if (btnReset) {
    btnReset.style.display = currentConversation.length > 0 ? '' : 'none';
  }
}

function resetConversation() {
  if (currentConversation.length > 0 && !confirm('Opravdu ukončit tuto konverzaci? Bude uložená v "Předchozí konverzace" a můžeš se k ní vrátit.')) {
    return;
  }
  currentConversation = [];
  currentConversationId = null;
  pendingImage = null;
  document.getElementById('otazka-text').value = '';
  hideImagePreview();
  renderConversation(false);
  updateContinueButton();
  updateBackButton();
}

// ---------- Image handling ----------
function onImagePicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Prosím vyber obrázek (JPG, PNG, WEBP).');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert('Obrázek je moc velký (>5 MB). Zmenši ho, prosím.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64 = dataUrl.split(',')[1];
    pendingImage = {
      data: base64,
      mimeType: file.type,
      dataUrl
    };
    showImagePreview(dataUrl);
  };
  reader.readAsDataURL(file);
  // Reset input so same file can be picked again after removal
  e.target.value = '';
}

function showImagePreview(dataUrl) {
  document.getElementById('image-preview-img').src = dataUrl;
  document.getElementById('image-preview').style.display = 'inline-block';
}

function hideImagePreview() {
  document.getElementById('image-preview').style.display = 'none';
  document.getElementById('image-preview-img').src = '';
}

function removePendingImage() {
  pendingImage = null;
  hideImagePreview();
}

// ---------- Conversation storage ----------
function persistCurrentConversation() {
  if (currentConversation.length === 0) return;
  if (!currentConversationId) {
    currentConversationId = 'conv-' + Date.now();
  }
  const firstUser = currentConversation.find(m => m.role === 'user');
  const title = firstUser ? firstUser.text.slice(0, 80) : 'Konverzace';
  Storage.saveConversation({
    id: currentConversationId,
    title,
    updatedAt: new Date().toISOString(),
    messages: currentConversation
  });
}

function openConversationsList() {
  const list = Storage.getConversations();
  const container = document.getElementById('conv-list-content');
  if (list.length === 0) {
    container.innerHTML = '<p class="muted small">Zatím žádné uložené konverzace.</p>';
  } else {
    container.innerHTML = list.map(c => {
      const d = new Date(c.updatedAt);
      const dateStr = d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
      const turnCount = c.messages.filter(m => m.role === 'user').length;
      return `
        <div class="conv-list-item" data-conv-id="${escapeHtml(c.id)}">
          <div class="conv-title">${escapeHtml(c.title)}${c.title.length >= 80 ? '…' : ''}</div>
          <div class="conv-meta">
            <span>${turnCount} ${turnCount === 1 ? 'otázka' : (turnCount < 5 ? 'otázky' : 'otázek')}</span>
            <span>${dateStr}</span>
          </div>
          <div class="flex flex-end mt-1">
            <button class="btn btn-secondary small" data-conv-del="${escapeHtml(c.id)}" style="font-size:.8rem;padding:.3rem .6rem;">🗑 Smazat</button>
          </div>
        </div>
      `;
    }).join('');
    container.querySelectorAll('.conv-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-conv-del]')) return;
        loadConversation(el.dataset.convId);
      });
    });
    container.querySelectorAll('[data-conv-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Smazat tuto konverzaci?')) {
          Storage.deleteConversation(btn.dataset.convDel);
          openConversationsList(); // re-render
        }
      });
    });
  }
  document.getElementById('modal-conv-list').classList.add('active');
}

function loadConversation(id) {
  const conv = Storage.getConversation(id);
  if (!conv) {
    alert('Konverzace nenalezena.');
    return;
  }
  currentConversation = conv.messages;
  currentConversationId = conv.id;
  pendingImage = null;
  hideImagePreview();
  document.getElementById('otazka-text').value = '';
  document.getElementById('modal-conv-list').classList.remove('active');
  // Přepni na záložku Otázka pokud tam nejsi
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('nav.tabs button[data-tab="otazka"]').classList.add('active');
  document.getElementById('tab-otazka').classList.add('active');
  renderConversation(false);
  updateContinueButton();
  updateBackButton();
  // Scroll k výstupu
  setTimeout(() => document.getElementById('otazka-output').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

async function runAnalysis(mode) {
  const textInput = document.getElementById('otazka-text');
  const text = textInput.value.trim();

  // Musí být text NEBO obrázek
  if (!text && !pendingImage) {
    alert('Napiš dotaz nebo přidej obrázek.');
    return;
  }

  const output = document.getElementById('otazka-output');
  const btnNew = document.getElementById('btn-analyze');
  const btnCont = document.getElementById('btn-continue');

  // Reset konverzace pro novou otázku
  if (mode === 'new' || currentConversation.length === 0) {
    // Pokud je aktuální konverzace neprázdná a nová = uložit ji nejdřív
    if (currentConversation.length > 0) {
      persistCurrentConversation();
    }
    currentConversation = [];
    currentConversationId = null;
    mode = 'new';
  }

  // Text pro zobrazení a historii — pokud je jen obrázek, dopiš placeholder
  const displayText = text || '(bez textu, jen obrázek)';

  // Uživatelská zpráva do konverzace (pro průběžný render)
  const userMessage = { role: 'user', text: displayText };
  if (pendingImage) {
    userMessage.image = { dataUrl: pendingImage.dataUrl };
  }
  currentConversation.push(userMessage);

  // Sestavit API zprávy — pro Gemini
  const apiMessages = [];
  if (mode === 'new') {
    // První zpráva: analytický prompt + text + případně obrázek
    const parts = [];
    const promptText = text
      ? `${buildAnalyzePrompt(text)}\n\n---\n\n${text}`
      : buildAnalyzePrompt('(uživatelka poslala pouze obrázek — analyzuj ho v kontextu jejího profilu)');
    parts.push({ text: promptText });
    if (pendingImage) {
      parts.push({
        inlineData: {
          mimeType: pendingImage.mimeType,
          data: pendingImage.data
        }
      });
    }
    apiMessages.push({ role: 'user', parts });
  } else {
    // Pokračování — sestavit historii, přidat obrázek do poslední user zprávy
    for (let i = 0; i < currentConversation.length; i++) {
      const m = currentConversation[i];
      const isLastUser = i === currentConversation.length - 1 && m.role === 'user';
      if (isLastUser && pendingImage) {
        // Přidej obrázek k poslední user zprávě
        apiMessages.push({
          role: 'user',
          parts: [
            { text: m.text },
            {
              inlineData: {
                mimeType: pendingImage.mimeType,
                data: pendingImage.data
              }
            }
          ]
        });
      } else {
        apiMessages.push({ role: m.role, text: m.text });
      }
    }
  }

  // Vykresli konverzaci + loading
  renderConversation(true);
  btnNew.disabled = true;
  btnCont.disabled = true;
  updateBackButton();

  // Vyčisti obrázek z composeru (i když voláme dál — obrázek je už v userMessage)
  const imageForHistory = pendingImage;
  pendingImage = null;
  hideImagePreview();

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
      recipes: Storage.getRecipes(),
      historyItems: Storage.getHistory(),
      foodsDb,
      herbsDb
    });
    const response = await client.generate(apiMessages, systemPrompt, {
      temperature: 0.55,
      maxOutputTokens: 4096
    });

    currentConversation.push({ role: 'model', text: response });
    renderConversation(false);
    persistCurrentConversation();

    saveToHistory(
      'otazka',
      mode === 'new' ? '💭' : '🔗',
      (mode === 'new' ? '' : '[pokračování] ') + displayText.slice(0, 80),
      displayText + (imageForHistory ? ' [+ obrázek]' : ''),
      response
    );

    textInput.value = '';
  } catch (e) {
    // Vrátit poslední uživatelskou zprávu zpět
    currentConversation.pop();
    // Vrátit i pendingImage, aby uživatelka mohla znovu poslat
    if (imageForHistory) {
      pendingImage = imageForHistory;
      showImagePreview(imageForHistory.dataUrl);
    }
    renderConversation(false);
    output.insertAdjacentHTML('beforeend', `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`);
  } finally {
    btnNew.disabled = false;
    updateContinueButton();
    updateBackButton();
    // Auto-scroll na konec konverzace (aby uživatelka viděla odpověď)
    setTimeout(() => {
      const last = output.lastElementChild;
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
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
      const imgHtml = msg.image?.dataUrl
        ? `<img class="turn-image" src="${escapeHtml(msg.image.dataUrl)}" alt="Nahraný obrázek">`
        : '';
      return `<div class="turn-user">
        <div class="turn-label">🙋 TY</div>
        <div>${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
        ${imgHtml}
      </div>`;
    } else {
      return `<div class="turn-ai card">
        <div class="turn-label">🌿 AI</div>
        ${renderMarkdown(msg.text)}
        ${makeSaveRecipeButton(msg.text)}
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

    output.innerHTML = `${dbInfo}<div class="card">${renderMarkdown(response)}${makeSaveRecipeButton(response)}</div>`;
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
    output.innerHTML = `<div class="card">${renderMarkdown(response)}${makeSaveRecipeButton(response)}</div>`;
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
        ${makeSaveRecipeButton(response)}
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
// Recepty
// ============================================================
let pendingRecipeContent = null; // text čekající na uložení do modalu

function setupRecepty() {
  document.getElementById('recepty-hledat').addEventListener('input', renderRecepty);
}

function setupRecipeModal() {
  document.getElementById('btn-cancel-recipe').addEventListener('click', closeSaveRecipeModal);
  document.getElementById('btn-confirm-recipe').addEventListener('click', confirmSaveRecipe);
}

function openSaveRecipeModal(content) {
  pendingRecipeContent = content;
  document.getElementById('recipe-name').value = '';
  document.getElementById('recipe-purpose').value = '';
  document.getElementById('recipe-tags').value = '';
  document.getElementById('recipe-preview').innerHTML = renderMarkdown(content.slice(0, 3000));
  document.getElementById('modal-save-recipe').classList.add('active');
  setTimeout(() => document.getElementById('recipe-name').focus(), 50);
}

function closeSaveRecipeModal() {
  document.getElementById('modal-save-recipe').classList.remove('active');
  pendingRecipeContent = null;
}

function confirmSaveRecipe() {
  const name = document.getElementById('recipe-name').value.trim();
  const purpose = document.getElementById('recipe-purpose').value.trim();
  const tagsRaw = document.getElementById('recipe-tags').value.trim();
  if (!name) {
    alert('Zadej název receptu.');
    return;
  }
  if (!purpose) {
    alert('Napiš, na co ti recept pomůže.');
    return;
  }
  if (!pendingRecipeContent) {
    alert('Chybí obsah receptu.');
    return;
  }
  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
    : [];
  const recipe = {
    id: 'recipe-' + Date.now(),
    createdAt: new Date().toISOString(),
    name,
    purpose,
    tags,
    content: pendingRecipeContent
  };
  Storage.saveRecipe(recipe);
  closeSaveRecipeModal();
  renderRecepty();
  // Krátká vizuální notifikace
  showToast(`✓ Recept "${name}" uložen do 📖 Recepty`);
}

function renderRecepty() {
  const container = document.getElementById('recepty-list');
  const query = (document.getElementById('recepty-hledat')?.value || '').trim();
  let recipes = Storage.getRecipes();

  if (query) {
    recipes = recipes.filter(r =>
      matchesSearch(r.name, query) ||
      matchesSearch(r.purpose, query) ||
      matchesSearch(r.content, query) ||
      matchesSearch((r.tags || []).join(' '), query)
    );
  }

  if (recipes.length === 0) {
    container.innerHTML = `<div class="empty">
      <div class="empty-icon">📖</div>
      <p>${query
        ? 'Nic nenalezeno.'
        : 'Zatím žádné recepty. Až ti AI navrhne nějaký (postup, rituál, nápoj, snídani...), klikni pod odpovědí <strong>💾 Uložit jako recept</strong>.'}</p>
    </div>`;
    return;
  }

  container.innerHTML = recipes.map(r => {
    const d = new Date(r.createdAt);
    const dateStr = d.toLocaleDateString('cs-CZ');
    const tagsHtml = (r.tags || []).map(t => `<span class="tag tag-fact">${escapeHtml(t)}</span>`).join(' ');
    return `
      <details class="card" style="margin-bottom:.5rem;">
        <summary style="cursor:pointer;list-style:none;">
          <div class="card-header" style="margin:0;">
            <span>
              <strong>📖 ${escapeHtml(r.name)}</strong>
              <div class="small muted" style="margin-top:.15rem;">🎯 ${escapeHtml(r.purpose)}</div>
            </span>
            <span class="card-date">${dateStr}</span>
          </div>
          ${tagsHtml ? `<div style="margin-top:.4rem;">${tagsHtml}</div>` : ''}
        </summary>
        <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border);">
          ${renderMarkdown(r.content)}
          <div class="flex flex-end mt-1">
            <button class="btn btn-secondary small" data-recipe-del="${escapeHtml(r.id)}" style="font-size:.85rem;">🗑 Smazat</button>
          </div>
        </div>
      </details>
    `;
  }).join('');

  container.querySelectorAll('[data-recipe-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm('Smazat tento recept?')) {
        Storage.deleteRecipe(btn.dataset.recipeDel);
        renderRecepty();
      }
    });
  });
}

// Malý toast na horní okraj obrazovky
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:var(--accent);color:white;padding:.75rem 1.25rem;border-radius:var(--radius-sm);box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:200;font-size:.9rem;transition:opacity .3s;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ============================================================
// Profil
// ============================================================
function setupProfil() {
  document.getElementById('btn-edit-profile').addEventListener('click', openProfileEditor);
  document.getElementById('btn-cancel-profile').addEventListener('click', closeProfileEditor);
  document.getElementById('btn-save-profile').addEventListener('click', saveProfileFromEditor);
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-review-update').addEventListener('click', runReviewUpdate);
}

async function runReviewUpdate() {
  const entries = Storage.getEntries();
  const btn = document.getElementById('btn-review-update');
  const output = document.getElementById('review-output');

  if (entries.length < 3) {
    output.innerHTML = `<div class="disclaimer">Máš zatím jen ${entries.length} záznam(ů) v deníku. Pro smysluplný review doporučuji aspoň 3–5 záznamů za posledních pár dní. Piš pravidelně a vrať se k tomuto za pár týdnů.</div>`;
    return;
  }

  output.innerHTML = '<div class="loading">Procházím tvůj deník a hledám vzorce</div>';
  btn.disabled = true;
  updateBackButton();

  try {
    const profile = Storage.getProfile();
    const journalSummary = entries.slice(0, 30).map((e, i) => {
      const d = new Date(e.date).toLocaleDateString('cs-CZ');
      return `[${d}] Nálada: ${e.nalada || '-'} | Jídlo: ${e.jidlo || '-'} | Příznaky: ${e.priznaky || '-'}`;
    }).join('\n');

    const reviewPrompt = `Zanalyzuj Zuzanin deník a navrhni, co v profilu aktualizovat.

# Poslední záznamy (nejnovější první):
${journalSummary}

# Úkol
Projdi záznamy a hledej:
1. **Nové příznaky** — které se opakují a nejsou v profilu
2. **Zmizelé příznaky** — které byly v profilu ale v deníku o nich nic není (možná se zlepšily)
3. **Změna vzorce** — posun z Kapha → Vata, z horka → chlad, ze stagnace → prázdnoty apod.
4. **Nová jídla / doplňky** — pravidelně se opakující nebo naopak vynechaná
5. **Emocní vzorce** — co se opakuje mentálně/emočně

# Formát odpovědi

Pro každý poznatek napiš:

**📌 [Typ změny]:** [Konkrétní popis]
**Evidence z deníku:** [citace ze záznamu s datem]
**Návrh na profil:** [co konkrétně přidat / odstranit / změnit]
**Jistota:** vysoká / střední / nízká

Pokud v deníku nic zásadního není, čestně to řekni.

Nekonči obecnými radami. Cílem je konkrétní údržba profilu, ne nová terapie.`;

    const response = await callAI('', reviewPrompt);
    output.innerHTML = `
      <div class="card mt-1">
        <div class="card-header">
          <strong>🔄 Review & Update ${new Date().toLocaleDateString('cs-CZ')}</strong>
        </div>
        ${renderMarkdown(response)}
        ${makeSaveRecipeButton(response)}
        <div class="mt-2">
          <p class="small muted">💡 Pro aplikování změn klikni na <strong>"Upravit profil (JSON)"</strong> dole a přidej/uprav ručně to, s čím souhlasíš. Nikdy nic nepřevádíme automaticky bez tvého souhlasu.</p>
        </div>
      </div>
    `;
    saveToHistory('review', '🔄', `Review profilu (${new Date().toLocaleDateString('cs-CZ')})`, 'Review profilu podle deníku', response);
  } catch (e) {
    output.innerHTML = `<div class="disclaimer"><strong>Chyba:</strong> ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    updateBackButton();
  }
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
