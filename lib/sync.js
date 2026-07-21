/**
 * Supabase sync module
 *
 * Synchronizuje lokální data mezi zařízeními přes Supabase REST API.
 * API klíč (publishable) je uložený jen v prohlížeči.
 *
 * Exposes: window.SupabaseSync, window.SyncManager
 */

(function() {

  class SupabaseSync {
    constructor(config) {
      this.url = (config?.url || '').replace(/\/$/, '');
      this.apiKey = config?.apiKey || '';
      this.userId = config?.userId || '';
      this.status = 'idle'; // 'idle' | 'syncing' | 'success' | 'error' | 'disabled'
      this.lastSync = null;
      this.lastError = null;
      this._listeners = [];
    }

    get enabled() {
      return !!(this.url && this.apiKey && this.userId);
    }

    onChange(callback) {
      this._listeners.push(callback);
      // Immediate call with current state
      callback(this);
    }

    _setStatus(status, error = null) {
      this.status = status;
      this.lastError = error;
      if (status === 'success') this.lastSync = new Date();
      this._listeners.forEach(cb => {
        try { cb(this); } catch (_) {}
      });
    }

    async _request(method, path, body = null, extraHeaders = {}) {
      const url = `${this.url}/rest/v1/${path}`;
      const headers = {
        'apikey': this.apiKey,
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...extraHeaders
      };
      const opts = { method, headers };
      if (body !== null) opts.body = JSON.stringify(body);
      const response = await fetch(url, opts);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Supabase ${response.status}: ${text.slice(0, 200)}`);
      }
      if (response.status === 204) return null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return null;
    }

    /**
     * Upsert data pro jeden data_type (klíč jako 'entries', 'profile', ...)
     */
    async push(dataType, data) {
      if (!this.enabled) return;
      const body = [{
        user_id: this.userId,
        data_type: dataType,
        data: data,
        updated_at: new Date().toISOString()
      }];
      return this._request(
        'POST',
        'user_data?on_conflict=user_id,data_type',
        body,
        { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
      );
    }

    /**
     * Stáhne všechna data pro uživatele.
     * Vrací mapu { data_type: data }.
     */
    async pullAll() {
      if (!this.enabled) return {};
      const path = `user_data?user_id=eq.${encodeURIComponent(this.userId)}&select=data_type,data,updated_at`;
      const rows = await this._request('GET', path);
      const result = {};
      for (const row of rows || []) {
        result[row.data_type] = row.data;
      }
      return result;
    }

    /**
     * Ověří spojení a přístup do tabulky.
     * Vrací true/false.
     */
    async ping() {
      if (!this.url || !this.apiKey) return false;
      try {
        await this._request('GET', 'user_data?limit=0&select=user_id');
        return true;
      } catch (e) {
        this.lastError = e.message;
        return false;
      }
    }
  }

  /**
   * SyncManager — vrstva nad SupabaseSync, řeší:
   * - Debounce (nespamuje serveru při rychlých změnách)
   * - Retry (pokud selže, zkusí znova)
   * - Frontu (uchová co má poslat, i offline)
   */
  class SyncManager {
    constructor(sync) {
      this.sync = sync;
      this.pending = new Map(); // key -> value
      this.timer = null;
      this.debounceMs = 2000;
    }

    schedule(key, value) {
      if (!this.sync.enabled) return;
      this.pending.set(key, value);
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }

    async flush() {
      if (this.pending.size === 0) return;
      if (!this.sync.enabled) return;

      const batch = Array.from(this.pending.entries());
      this.pending.clear();
      this.sync._setStatus('syncing');

      const failed = [];
      for (const [key, value] of batch) {
        try {
          await this.sync.push(key, value);
        } catch (e) {
          console.error(`Sync push failed for ${key}:`, e);
          failed.push([key, value]);
        }
      }

      if (failed.length > 0) {
        // Vrátit selhavší do fronty
        for (const [k, v] of failed) this.pending.set(k, v);
        this.sync._setStatus('error', `${failed.length} zpráv se nepodařilo poslat`);
        // Retry za 30s
        setTimeout(() => this.flush(), 30000);
      } else {
        this.sync._setStatus('success');
      }
    }
  }

  window.SupabaseSync = SupabaseSync;
  window.SyncManager = SyncManager;

})();
