'use strict';
// "Found uses": the creator shows where a work appeared; the local vision model describes it,
// the description is matched against the creator's own catalogue, and the sighting is kept so the
// home list can mark it unlicensed / offer sent / paid. Licensing itself goes through the existing
// /api/licenses and /order routes; nothing here creates rights or money movement.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const found = require('../public/found-offer.js');

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };

// Canned readings for the three built-in sample screenshots (used when the vision model is not reachable).
const SAMPLES = Object.freeze({
  'museum-web': { title: 'Museum website homepage', workId: 'the-tidal-archive', where: 'a museum website homepage', business: 'Saltmarsh Maritime Museum',
    description: 'A browser window showing a museum website. The large hero picture is an illustration of a tall library on a causeway above the turning tide at dusk, under a Spring Exhibition heading with an Visit us button.',
    keywords: ['library', 'causeway', 'tide', 'museum', 'website', 'hero'], setting: 'web' },
  'insta-post': { title: 'Social post', workId: 'the-last-light', where: 'a cafe\'s social media post', business: 'Harbour Lights Cafe',
    description: 'A square social media post with a heart button and likes. The picture is an illustration of a keeper walking down a basalt headland while a small boat sails home in the last light.',
    keywords: ['keeper', 'headland', 'boat', 'last light', 'instagram', 'post', 'likes'], setting: 'social' },
  'print-guide': { title: 'Printed exhibition guide', workId: 'the-tidal-archive', where: 'a printed exhibition guide cover', business: 'Saltmarsh Maritime Museum',
    description: 'A photo of a printed exhibition guide booklet lying on a table. The cover shows an illustration of a library on a causeway above the tide, with the words Spring Exhibition Guide and a price.',
    keywords: ['library', 'causeway', 'tide', 'booklet', 'guide', 'printed', 'cover'], setting: 'print' }
});

const PROMPT = 'You look at a screenshot or photo that shows a creative work (an illustration, photo, design or similar) being used somewhere. '
  + 'Reply with JSON only: {"description": one or two sentences describing what the creative work itself depicts (subject, scene, objects, colours), '
  + '"keywords": up to 8 short words about the work itself, "setting": one of "web","social","print","commercial" for where it is being used, '
  + '"where": a short phrase for the place it appears (for example "a museum website homepage"), '
  + '"business": the name of the person or business using it if it is visible, otherwise an empty string}.';

async function describeImage(env, dataUrl, signal) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw fail('Choose a PNG, JPEG or WebP picture.');
  const response = await globalThis.fetch((env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '') + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal || AbortSignal.timeout(120000),
    body: JSON.stringify({ model: env.OLLAMA_VISION_MODEL || 'qwen2.5vl:3b', stream: false, format: 'json', options: { temperature: 0 },
      messages: [{ role: 'user', content: PROMPT, images: [m[2]] }] })
  });
  if (!response.ok) throw fail('The local vision model could not read this picture (' + response.status + ').', 503);
  const data = await response.json();
  let out;
  try { out = JSON.parse(data.message?.content || ''); } catch { throw fail('The local vision model gave no usable description.', 503); }
  const text = v => (typeof v === 'string' ? v.trim().slice(0, 600) : '');
  const description = text(out.description);
  if (!description) throw fail('The local vision model gave no usable description.', 503);
  return { description, keywords: (Array.isArray(out.keywords) ? out.keywords : []).map(k => text(k).slice(0, 40)).filter(Boolean).slice(0, 8),
    setting: ['web', 'social', 'print', 'commercial'].includes(out.setting) ? out.setting : '', where: text(out.where).slice(0, 120), business: text(out.business).slice(0, 100) };
}

function create({ dataFile, env = process.env }) {
  const file = path.join(path.dirname(dataFile), 'found.json');
  const load = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && d.sightings ? d : { sightings: {} }; } catch { return { sightings: {} }; } };
  const save = d => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 }); fs.renameSync(tmp, file); };
  const view = s => { const { image, ...rest } = s; return { ...rest, imageUrl: image ? '/api/found/' + s.id + '/image' : null }; };
  const candidatesFor = (text, works) => found.match(text, works).slice(0, 4).map(c => {
    const w = works.find(x => x.id === c.id);
    return { id: w.id, title: w.title, creator: w.creator, preview: w.preview, priceCents: w.priceCents, permitted: w.permitted, score: c.score, matched: c.matched };
  });
  const markOf = (license) => {
    if (!license) return 'unlicensed';
    if (license.status === 'issued') return 'paid';
    if (['requested', 'changes_requested'].includes(license.status)) return 'request';
    if (['withdrawn', 'superseded'].includes(license.status)) return 'unlicensed';
    return 'sent';
  };

  async function handle({ method, pathname, body, data, authorize, req, works, inspectOrder }) {
    if (method === 'GET' && pathname === '/api/found/samples')
      return { samples: Object.entries(SAMPLES).map(([id, s]) => ({ id, title: s.title, workId: s.workId, scene: s.setting, where: s.where })) };

    if (method === 'GET' && pathname === '/api/found/list') {
      const store = load().sightings, linked = new Set(), items = [], all = works();
      for (const s of Object.values(store)) {
        const license = s.licenseId ? data.licenses[s.licenseId] : null;
        if (license) linked.add(license.id);
        const work = all.find(w => w.id === (s.assetId || license?.request.assetId));
        items.push({ id: s.id, kind: 'sighting', title: work?.title || 'Work not chosen yet', where: s.where || '', who: license?.request.licensee || s.business || '',
          mark: markOf(license), licenseId: license?.id || null, priceCents: license?.quote.priceCents ?? null, status: license?.status || null,
          imageUrl: s.image ? '/api/found/' + s.id + '/image' : null, workPreview: work?.preview || null, useLabel: s.use?.label || '', createdAt: s.createdAt, approvalUrl: license?.approvalUrl || null, sighting: view(s) });
      }
      for (const l of Object.values(data.licenses)) {
        if (linked.has(l.id) || ['withdrawn', 'superseded'].includes(l.status)) continue;
        const work = all.find(w => w.id === l.request.assetId);
        items.push({ id: l.id, kind: 'license', title: work?.title || l.quote.assetTitle, where: l.request.project, who: l.request.licensee, mark: markOf(l), licenseId: l.id,
          priceCents: l.quote.priceCents, status: l.status, imageUrl: null, workPreview: work?.preview || null, useLabel: l.request.medium, createdAt: l.createdAt, approvalUrl: l.approvalUrl || null });
      }
      items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { items };
    }

    const img = pathname.match(/^\/api\/found\/([a-f0-9]{16})\/image$/);
    if (method === 'GET' && img) {
      const s = load().sightings[img[1]];
      const m = s?.image && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(s.image);
      if (!m) throw fail('No picture was kept for this use.', 404);
      return { download: Buffer.from(m[2], 'base64'), mime: m[1], filename: 'use', inline: true };
    }
    const pay = pathname.match(/^\/api\/found\/payment\/([a-f0-9]{64})$/);
    if (method === 'GET' && pay) {
      const license = data.licenses[pay[1]];
      if (!license) throw fail('No such license.', 404);
      if (license.status === 'issued') return { state: 'issued' };
      if (!license.orderId) return { state: 'none' };
      return { state: String((await inspectOrder(license))?.status || 'UNKNOWN') };
    }

    if (method !== 'POST') throw fail('No such route.', 404);
    authorize(req, body);

    if (pathname === '/api/found/analyze') {
      const list = works();
      let reading, source;
      if (typeof body.text === 'string' && body.text.trim() && !body.image) {
        source = 'text';
        reading = { description: body.text.trim().slice(0, 600), keywords: [], setting: '', where: '', business: '' };
      } else if (typeof body.image === 'string') {
        if (body.image.length > 3.5 * 1024 * 1024) throw fail('That picture is too large. Try a smaller screenshot.', 413);
        try { reading = await describeImage(env, body.image); source = 'vision'; }
        catch (error) {
          const sample = SAMPLES[body.sample];
          if (!sample) throw fail(error.status === 400 ? error.message : 'The local vision model is not available right now. Describe what the picture shows in a sentence instead; nothing was changed.', 503);
          reading = sample; source = 'sample';
        }
      } else throw fail('Add a picture, or describe where your work appeared.');
      if (typeof body.where === 'string' && body.where.trim()) reading = { ...reading, where: body.where.trim().slice(0, 120) };
      const text = reading.description + ' ' + (reading.keywords || []).join(' ') + ' ' + (reading.where || '');
      const use = found.inferUse(text, reading.setting);
      const d = load();
      const s = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), source, description: reading.description, keywords: reading.keywords || [],
        where: reading.where || '', business: reading.business || '', use, candidates: candidatesFor(text, list), assetId: null, licenseId: null,
        image: typeof body.image === 'string' ? body.image : null };
      d.sightings[s.id] = s; save(d);
      return { sighting: view(s) };
    }

    const op = pathname.match(/^\/api\/found\/([a-f0-9]{16})\/(confirm|link)$/);
    if (op) {
      const d = load(), s = d.sightings[op[1]];
      if (!s) throw fail('This sighting is no longer saved.', 404);
      if (op[2] === 'confirm') {
        if (!works().some(w => w.id === body.assetId)) throw fail('Choose one of your listed works.');
        s.assetId = body.assetId;
      } else {
        const license = data.licenses[body.licenseId];
        if (!license || license.request.assetId !== s.assetId) throw fail('That license does not belong to this sighting.', 409);
        s.licenseId = license.id; s.sentAt = new Date().toISOString();
      }
      save(d); return { sighting: view(s) };
    }
    throw fail('No such route.', 404);
  }
  return { handle };
}

module.exports = { create, SAMPLES, describeImage };
