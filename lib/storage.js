/**
 * Local storage abstraction
 * — wraps localStorage with namespacing and JSON handling
 *
 * Exposes: window.Storage
 */

(function() {
  const NS = 'zdravi.';

  const Storage = {
    get(key, defaultValue = null) {
      try {
        const raw = localStorage.getItem(NS + key);
        if (raw === null) return defaultValue;
        return JSON.parse(raw);
      } catch (e) {
        console.error('Storage.get error', key, e);
        return defaultValue;
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(NS + key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('Storage.set error', key, e);
        return false;
      }
    },

    remove(key) {
      localStorage.removeItem(NS + key);
    },

    // Convenience accessors
    getApiKey() { return this.get('apiKey'); },
    setApiKey(key) { return this.set('apiKey', key); },

    getModel() { return this.get('model', 'gemini-3.5-flash'); },
    setModel(model) { return this.set('model', model); },

    getProfile() { return this.get('profile'); },
    setProfile(p) { return this.set('profile', p); },

    getEntries() { return this.get('entries', []); },
    addEntry(entry) {
      const all = this.getEntries();
      all.unshift(entry);
      return this.set('entries', all);
    },
    deleteEntry(id) {
      const all = this.getEntries().filter(e => e.id !== id);
      return this.set('entries', all);
    },

    getTimeline() { return this.get('timeline', []); },
    setTimeline(t) { return this.set('timeline', t); },

    getCustomShortcuts() { return this.get('customShortcuts', []); },
    addCustomShortcut(s) {
      const all = this.getCustomShortcuts();
      all.push(s);
      return this.set('customShortcuts', all);
    },
    deleteCustomShortcut(id) {
      const all = this.getCustomShortcuts().filter(s => s.id !== id);
      return this.set('customShortcuts', all);
    },

    // Saved conversations from Otázka tab (multi-turn dialogs)
    getConversations() { return this.get('conversations', []); },
    saveConversation(conv) {
      // conv = { id, title, updatedAt, messages: [{role, text, image?}] }
      const all = this.getConversations();
      const idx = all.findIndex(c => c.id === conv.id);
      if (idx >= 0) {
        all[idx] = conv;
      } else {
        all.unshift(conv);
      }
      // Keep max 50 conversations
      if (all.length > 50) all.length = 50;
      return this.set('conversations', all);
    },
    deleteConversation(id) {
      const all = this.getConversations().filter(c => c.id !== id);
      return this.set('conversations', all);
    },
    getConversation(id) {
      return this.getConversations().find(c => c.id === id);
    },

    // Recepty — recipes / rituals saved from AI responses
    getRecipes() { return this.get('recipes', []); },
    saveRecipe(r) {
      const all = this.getRecipes();
      const idx = all.findIndex(x => x.id === r.id);
      if (idx >= 0) all[idx] = r;
      else all.unshift(r);
      if (all.length > 200) all.length = 200;
      return this.set('recipes', all);
    },
    deleteRecipe(id) {
      const all = this.getRecipes().filter(r => r.id !== id);
      return this.set('recipes', all);
    },

    // History of AI interactions (Otázka, Jídlo, Zkratky)
    getHistory() { return this.get('history', []); },
    addHistoryEntry(entry) {
      const all = this.getHistory();
      all.unshift(entry);
      // Keep max 200 entries to avoid bloating localStorage
      if (all.length > 200) all.length = 200;
      return this.set('history', all);
    },
    deleteHistoryEntry(id) {
      const all = this.getHistory().filter(e => e.id !== id);
      return this.set('history', all);
    },
    clearHistory() { return this.set('history', []); }
  };

  window.Storage = Storage;
})();
