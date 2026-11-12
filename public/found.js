'use strict';
(function () {
  const F = window.foundOffer, $ = id => document.getElementById(id);
  const S = { config: {}, works: [], sighting: null, shot: null, sample: null, work: null, offer: null, quote: null, license: null, busy: false };

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v === false || v == null) continue; if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  }
  let toastTimer;
  function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200); }
  function show(id) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
    window.scrollTo(0, 0);
    const heading = $(id).querySelector('h1,h2'); if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  }
  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, creatorCode: $('creator-code').value || undefined }) };
    const r = await fetch(path, opts), data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong (' + r.status + ').');
    return data;
  }

  // ---------- sample screenshots, drawn on a canvas so the demo needs no files ----------
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not load ' + src)); i.src = src; }); }
  function cover(ctx, img, x, y, w, hh, r) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, hh, r || 0); ctx.clip();
    const s = Math.max(w / img.width, hh / img.height), iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (hh - ih) / 2, iw, ih); ctx.restore();
  }
  function text(ctx, str, x, y, font, color, align) { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(str, x, y); }
  async function scene(sample) {
    const work = S.works.find(w => w.id === sample.workId) || S.works[0];
    const art = await loadImg(work.preview), c = document.createElement('canvas'), ctx = c.getContext('2d');
    const SANS = '600 {n}px system-ui, sans-serif';
    const f = (n, w) => (w || '600') + ' ' + n + 'px system-ui, sans-serif';
    if (sample.scene === 'web') {
      c.width = 1000; c.height = 640; ctx.fillStyle = '#eef0f3'; ctx.fillRect(0, 0, 1000, 640);
      ctx.fillStyle = '#dfe3e8'; ctx.fillRect(0, 0, 1000, 54);
      ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(26 + i * 22, 27, 6, 0, 7); ctx.fill(); });
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(120, 12, 560, 30, 15); ctx.fill(); text(ctx, 'saltmarshmuseum.org/spring-exhibition', 140, 33, f(14, '400'), '#566');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 54, 1000, 60); text(ctx, 'Saltmarsh Maritime Museum', 36, 92, f(20, '700'), '#1b2a38');
      ['Visit', 'Exhibitions', 'Shop', 'About'].forEach((t, i) => text(ctx, t, 600 + i * 98, 91, f(15, '500'), '#445'));
      cover(ctx, art, 0, 114, 1000, 400, 0); ctx.fillStyle = 'rgba(10,20,30,.45)'; ctx.fillRect(0, 114, 1000, 400);
      text(ctx, 'Spring Exhibition', 60, 330, f(54, '700'), '#fff'); text(ctx, 'Tides, lamps and the libraries between them', 60, 372, f(22, '400'), '#e8eef3');
      ctx.fillStyle = '#e9b44c'; ctx.beginPath(); ctx.roundRect(60, 400, 160, 48, 24); ctx.fill(); text(ctx, 'Visit us', 140, 431, f(18, '700'), '#241', 'center');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 514, 1000, 126); text(ctx, 'Open daily 10 to 5. Free for members.', 60, 580, f(18, '400'), '#445');
    } else if (sample.scene === 'social') {
      c.width = 640; c.height = 820; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 820);
      ctx.fillStyle = '#d98a6c'; ctx.beginPath(); ctx.arc(46, 46, 22, 0, 7); ctx.fill(); text(ctx, 'harbourlightscafe', 84, 52, f(19, '700'), '#202020'); text(ctx, 'Harbour Lights Cafe · Bristol', 84, 74, f(13, '400'), '#777');
      cover(ctx, art, 0, 92, 640, 560, 0);
      text(ctx, '♡   ◯   ➤', 22, 700, f(30, '400'), '#202020'); text(ctx, '1,284 likes', 22, 738, f(17, '700'), '#202020');
      text(ctx, 'harbourlightscafe  Our new menu is out. Come in from the cold!', 22, 768, f(15, '400'), '#202020'); text(ctx, '#coffee #harbour #bristol', 22, 794, f(15, '400'), '#3b6ea5');
    } else {
      c.width = 760; c.height = 940; const g = ctx.createLinearGradient(0, 0, 760, 940); g.addColorStop(0, '#6b4f36'); g.addColorStop(1, '#4a3524'); ctx.fillStyle = g; ctx.fillRect(0, 0, 760, 940);
      ctx.save(); ctx.translate(380, 470); ctx.rotate(-0.04); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
      ctx.fillStyle = '#f7f1e3'; ctx.fillRect(-270, -380, 540, 760); ctx.shadowColor = 'transparent';
      cover(ctx, art, -246, -356, 492, 420, 4); text(ctx, 'SPRING EXHIBITION', -246, 130, f(34, '700'), '#1d2b36'); text(ctx, 'The Visitor Guide', -246, 168, f(24, '400'), '#33454f');
      ctx.fillStyle = '#c9b88f'; ctx.fillRect(-246, 196, 80, 3); text(ctx, 'Saltmarsh Maritime Museum', -246, 232, f(16, '400'), '#33454f'); text(ctx, '£4.00', 246, 340, f(22, '700'), '#1d2b36', 'right'); ctx.restore();
    }
    return c.toDataURL('image/jpeg', 0.85);
  }

  async function fileToDataUrl(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url), s = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- home list ----------
  const MARKS = { paid: 'Paid', sent: 'Offer sent', unlicensed: 'Unlicensed use found', request: 'Buyer request' };
  async function loadList() {
    try {
      const { items } = await api('/api/found/list');
      $('list-count').textContent = items.length ? items.length + (items.length === 1 ? ' item' : ' items') : '';
      $('list-empty').hidden = items.length > 0;
      $('list').replaceChildren(...items.map(row));
    } catch (e) { $('home-status').textContent = e.message; }
  }
  function row(item) {
    const pic = item.imageUrl || item.workPreview;
    const body = h('div', { class: 'row-main' },
      h('div', { class: 'row-top' }, h('strong', {}, item.title), h('span', { class: 'mark ' + item.mark }, h('i', { 'aria-hidden': 'true' }), MARKS[item.mark])),
      h('p', { class: 'soft' }, [item.who, item.where].filter(Boolean).join(' · ') || 'No details yet'),
      item.priceCents != null ? h('p', { class: 'price-small' }, F.money(item.priceCents)) : null);
    const actions = [];
    if (item.mark === 'sent') {
      if (item.approvalUrl) actions.push(h('a', { class: 'btn small', href: item.approvalUrl, target: '_blank', rel: 'noopener noreferrer' }, 'PayPal link'));
      actions.push(h('button', { class: 'btn small', type: 'button', onclick: () => checkPayment(item) }, 'Check payment'));
    }
    if (item.mark === 'paid') actions.push(h('a', { class: 'btn small', href: '/#vault' }, 'Records'));
    const open = item.mark === 'unlicensed' && item.sighting ? h('button', { class: 'row-open', type: 'button', onclick: () => resume(item), 'aria-label': 'Continue with ' + item.title }, 'Continue') : null;
    return h('li', { class: 'row' }, h('div', { class: 'thumb' }, pic ? h('img', { src: pic, alt: '', loading: 'lazy' }) : null), body, actions.length || open ? h('div', { class: 'row-actions' }, open, actions) : null);
  }
  async function checkPayment(item) {
    try {
      const { state } = await api('/api/found/payment/' + item.licenseId);
      if (state === 'APPROVED') { await api('/api/licenses/' + item.licenseId + '/capture', {}); toast('Payment received. License issued.'); }
      else if (state === 'COMPLETED') { await api('/api/licenses/' + item.licenseId + '/reconcile', {}); toast('Payment confirmed. License issued.'); }
      else if (state === 'issued') toast('Already paid.');
      else toast('Not paid yet. The buyer has not approved the PayPal checkout.');
    } catch (e) { toast(e.message); }
    loadList();
  }

  // ---------- add a picture ----------
  async function analyze(payload, shot) {
    if (S.busy) return; S.busy = true; S.shot = shot || null;
    $('analyzing-shot').hidden = !shot; if (shot) $('analyzing-shot').src = shot;
    $('analyzing-text').textContent = shot ? 'Reading the picture on this computer…' : 'Looking through your catalogue…';
    show('analyzing');
    try {
      const { sighting } = await api('/api/found/analyze', payload);
      S.sighting = sighting; await showConfirm();
    } catch (e) { show('home'); $('home-status').textContent = e.message; toast(e.message); }
    finally { S.busy = false; }
  }
  async function pickFile(file) {
    if (!file || !/^image\//.test(file.type)) return toast('Choose a picture file.');
    try { const shot = await fileToDataUrl(file); S.sample = null; analyze({ image: shot }, shot); } catch (e) { toast('Could not open that picture.'); }
  }
  async function pickSample(sample) {
    try { const shot = await scene(sample); S.sample = sample.id; analyze({ image: shot, sample: sample.id }, shot); } catch (e) { toast(e.message); }
  }

  // ---------- confirm which work ----------
  async function showConfirm() {
    const s = S.sighting, shotSrc = s.imageUrl || S.shot;
    $('confirm-shot').hidden = !shotSrc; if (shotSrc) $('confirm-shot').src = shotSrc;
    $('confirm-caption').replaceChildren(h('span', { class: 'chip static' }, s.use.label), ' ', s.description);
    const top = s.candidates[0], clear = top && top.score >= 3 && (!s.candidates[1] || top.score > s.candidates[1].score);
    $('confirm-sub').textContent = clear ? 'The best match is first. Tap it if it is yours.' : 'I could not tell for sure. Tap the one it is.';
    const cands = s.candidates.length ? s.candidates : S.works.slice(0, 3).map(w => ({ id: w.id, title: w.title, preview: w.preview, priceCents: w.priceCents, matched: [] }));
    $('cand-list').replaceChildren(...cands.map((c, i) => h('article', { class: 'cand' + (i === 0 && clear ? ' best' : '') },
      h('img', { src: c.preview, alt: c.title + ' (artwork)' }),
      h('div', { class: 'cand-body' }, h('strong', {}, c.title), h('p', { class: 'soft' }, c.matched && c.matched.length ? 'Matches: ' + c.matched.join(', ') : 'From your catalogue'),
        h('button', { class: 'btn ' + (i === 0 && clear ? 'primary' : ''), type: 'button', onclick: () => choose(c.id) }, i === 0 && clear ? 'Yes, this is it' : 'This one')))));
    show('confirm');
  }
  async function choose(assetId) {
    try {
      await api('/api/found/' + S.sighting.id + '/confirm', { assetId });
      S.work = S.works.find(w => w.id === assetId);
      S.offer = F.defaultOffer({ work: S.work, use: S.sighting.use, who: S.sighting.business, where: S.sighting.where });
      await renderOffer(); show('offer');
    } catch (e) { toast(e.message); }
  }

  // ---------- the offer sheet ----------
  async function requote() {
    const o = S.offer;
    try {
      const r = await api('/api/review', F.toRequest(o)); S.quote = r.quote; S.work = { ...S.work, ...r.work };
    } catch (e) { S.quote = null; $('offer-notes').replaceChildren(h('li', { class: 'bad' }, e.message)); }
  }
  async function renderOffer() {
    const o = S.offer, w = S.work;
    $('offer-shot').hidden = !(S.sighting.imageUrl || S.shot); $('offer-shot').src = S.sighting.imageUrl || S.shot || '';
    $('offer-work').src = w.preview; $('offer-title').textContent = w.title; $('offer-by').textContent = 'by ' + (w.creator || 'you');
    if (document.activeElement !== $('offer-who')) $('offer-who').value = o.licensee;
    $('offer-seen').textContent = S.sighting.use.reason + (S.sighting.where ? ' · ' + S.sighting.where : '');
    const permitted = w.permitted || [];
    $('use-seg').replaceChildren(...['website', 'social', 'print'].map(m => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.medium === m), class: 'seg-b' + (o.medium === m ? ' on' : ''), disabled: !permitted.includes(m), title: permitted.includes(m) ? null : 'Not part of this work\'s instant license', onclick: () => change({ medium: m, copies: m === 'print' ? (o.copies || Math.min(500, w.maxCopies || 500)) : 0 }) }, F.MEDIUM_LABEL[m])));
    $('copies-group').hidden = o.medium !== 'print'; $('copies-out').textContent = (o.copies || 0).toLocaleString('en-US');
    const maxTerm = w.maxTermMonths || 12, lens = [3, 6, 12].filter(n => n <= maxTerm);
    if (!lens.includes(o.termMonths)) lens.push(o.termMonths); lens.sort((a, b) => a - b);
    $('len-seg').replaceChildren(...lens.map(n => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.termMonths === n), class: 'seg-b' + (o.termMonths === n ? ' on' : ''), onclick: () => change({ termMonths: n }) }, F.TERM_LABEL(n))));
    $('offer-territory').textContent = o.territory;
    $('say-examples').replaceChildren(...['make it one year', 'social only, not print', '6 months'].map(t => h('button', { type: 'button', class: 'chip', onclick: () => { $('say').value = t; $('say-form').requestSubmit(); } }, t)));
    await requote(); paintQuote();
  }
  function paintQuote() {
    const q = S.quote;
    $('offer-price').textContent = q ? F.money(q.priceCents) : '—';
    const notes = q ? q.findings.filter(f => !f.ok).map(f => h('li', { class: 'bad' }, f.text)) : [];
    if (q && !notes.length) notes.push(h('li', { class: 'good' }, 'Inside the published policy for this work. ' + F.describeUse(S.offer) + '.'));
    $('offer-notes').replaceChildren(...notes);
    $('make-link').disabled = !q || !q.eligible || S.busy;
  }
  async function change(patch) { S.offer = { ...S.offer, ...patch }; await renderOffer(); }

  $('copies-minus').addEventListener('click', () => change({ copies: Math.max(100, (S.offer.copies || 500) - 100) }));
  $('copies-plus').addEventListener('click', () => change({ copies: (S.offer.copies || 500) + 100 }));
  $('offer-who').addEventListener('input', e => { S.offer.licensee = e.target.value; });
  $('say-form').addEventListener('submit', async e => {
    e.preventDefault();
    const r = F.parseEdit($('say').value, S.offer);
    if (!r.ok) { $('say-status').textContent = r.hint ? r.notes[0] : 'I did not catch a change. Try "make it one year" or "social only".'; return; }
    $('say-status').textContent = 'Changed: ' + r.notes.join(', ') + '.'; $('say').value = '';
    if (r.patch.medium && r.patch.medium !== 'print') r.patch.copies = 0;
    if (r.patch.medium === 'print' && !r.patch.copies && !S.offer.copies) r.patch.copies = 500;
    await change(r.patch);
  });

  // ---------- one tap: existing licensing path, then the message ----------
  $('make-link').addEventListener('click', async () => {
    if (!S.offer.licensee.trim()) { $('offer-who').focus(); toast('Who is using it? Add a name or business first.'); return; }
    S.busy = true; $('make-link').disabled = true; $('make-link').textContent = 'Creating the PayPal link…';
    try {
      const req = F.toRequest(S.offer);
      let license = S.license && S.license.__for === JSON.stringify(req) ? S.license : null;
      if (!license) {
        const made = await api('/api/licenses', { request: req, creatorApproved: true, ...(S.work.custom ? { expectedOfferRevision: S.work.offerRevision } : {}) });
        license = made.license;
      }
      if (license.status === 'approved') license = (await api('/api/licenses/' + license.id + '/order', {})).license;
      if (!license.approvalUrl) throw new Error('PayPal did not return a checkout link. The offer is saved; try again in a moment.');
      license.__for = JSON.stringify(req); S.license = license;
      await api('/api/found/' + S.sighting.id + '/link', { licenseId: license.id });
      showSent(license);
    } catch (e) { toast(e.message); }
    finally { S.busy = false; $('make-link').textContent = 'Create PayPal link and message'; paintQuote(); }
  });
  function showSent(license) {
    const q = license.quote;
    $('sent-title').textContent = 'Your offer is ready';
    $('sent-line').textContent = S.work.title + ' · ' + F.describeUse(S.offer) + ' · ' + F.money(q.priceCents);
    $('pp-link').href = license.approvalUrl;
    $('msg').value = F.message({ offer: S.offer, work: S.work, priceCents: q.priceCents, url: license.approvalUrl, creator: S.work.creator });
    $('sent-status').textContent = '';
    show('sent');
  }
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); $('sent-status').textContent = label + ' copied.'; }
    catch { $('msg').focus(); $('msg').select(); $('sent-status').textContent = 'Select the text and copy it.'; }
  }
  $('copy-msg').addEventListener('click', () => copy($('msg').value, 'Message'));
  $('copy-link').addEventListener('click', () => copy($('pp-link').href, 'Link'));
  $('sent-done').addEventListener('click', async () => { S.license = null; show('home'); await loadList(); });

  function resume(item) {
    S.sighting = item.sighting; S.shot = null; S.license = null;
    if (item.sighting.assetId) { choose(item.sighting.assetId); } else showConfirm();
  }

  // ---------- wiring ----------
  $('file').addEventListener('change', e => { pickFile(e.target.files[0]); e.target.value = ''; });
  document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type)); if (f && !$('home').hidden) pickFile(f); });
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); pickFile(e.dataTransfer.files[0]); });
  $('words-go').addEventListener('click', () => { const t = $('words-text').value.trim(); if (t.length < 8) return toast('Describe the picture in a few words.'); analyze({ text: t }, null); });
  $('confirm-back').addEventListener('click', async () => { show('home'); await loadList(); });
  $('none-of-these').addEventListener('click', async () => { toast('Saved as an unlicensed use. Come back to it from your list.'); show('home'); await loadList(); });
  $('offer-back').addEventListener('click', () => showConfirm());

  async function start() {
    try {
      S.config = await api('/api/config'); $('code-field').hidden = !S.config.creatorCodeRequired;
      const cat = await api('/api/catalog'); S.works = cat.works;
      const { samples } = await api('/api/found/samples');
      $('sample-row').replaceChildren(...samples.map(s => h('button', { type: 'button', class: 'chip', onclick: () => pickSample(s) }, s.title)));
    } catch (e) { $('home-status').textContent = e.message; }
    await loadList();
  }
  start();
})();
