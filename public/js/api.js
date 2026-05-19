/* API helper partagé — toutes les apps l'utilisent */

const api = {
  async _fetch(url, opts = {}) {
    try {
      const res = await fetch(url, { credentials: 'include', ...opts });
      if (res.status === 401) { if (window.location.pathname !== '/login') window.location.href = '/login'; return null; }
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.redirect) {
          window.location.href = data.redirect + '?error=' + encodeURIComponent('Application non activée pour votre compte');
        }
        return { error: data.error || 'Accès refusé', status: 403 };
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erreur serveur' }));
        return { ...data, status: res.status };
      }
      return res.json();
    } catch (e) {
      console.error('API error:', e);
      return { error: 'Erreur réseau' };
    }
  },

  get(url) { return this._fetch(url); },

  post(url, data) {
    return this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  put(url, data) {
    return this._fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  },

  del(url) { return this._fetch(url, { method: 'DELETE' }); },

  postForm(url, formData) {
    return this._fetch(url, { method: 'POST', body: formData });
  },

  putForm(url, formData) {
    return this._fetch(url, { method: 'PUT', body: formData });
  }
};
