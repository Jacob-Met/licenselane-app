'use strict';
// Pure helpers for the "found uses" flow, shared by the server and the browser:
// matching a description to works, reading the kind of use, sizing an offer, applying a spoken or typed change.
(function (root, factory) { const api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; else root.foundOffer = api; })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STOP = new Set('the and for with from that this are was were its into over under near above below out one two three image photo picture screenshot shows showing show appears there their his her has have will not you your a an of in on at to by is it as or be'.split(' '));
  const stem = w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const tokens = text => String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem);

  // Score each work by how many words of the description appear in its title and description.
  function match(text, works) {
    const wanted = [...new Set(tokens(text))], lower = String(text || '').toLowerCase();
    return works.map(w => {
      const title = new Set(tokens(w.title)), body = new Set(tokens([w.description, w.kind, w.edition].join(' ')));
      let score = 0; const matched = [];
      for (const t of wanted) { if (title.has(t)) { score += 3; matched.push(t); } else if (body.has(t)) { score += 1; matched.push(t); } }
      if (lower.includes(String(w.title).toLowerCase())) score += 10;
      return { id: w.id, score, matched: matched.slice(0, 6) };
    }).sort((a, b) => b.score - a.score);
  }

  const RULES = [
    ['social', /\b(instagram|insta|facebook|tiktok|reel|story|stories|tweet|pinterest|linkedin|social media|social post|likes?|followers?|hashtag|feed)\b/i, 'Looks like a social post'],
    ['commercial', /\b(shop|store|product|merch|merchandise|t-?shirt|mug|poster for sale|advert|advertisement|sponsored|packaging|price tag|add to cart|buy now|for sale|brand|sale)\b/i, 'Looks like a commercial product or advert'],
    ['print', /\b(print|printed|magazine|booklet|brochure|flyer|leaflet|poster|book cover|catalog(ue)?|guide|newspaper|billboard|paper)\b/i, 'Looks like a printed piece'],
    ['web', /\b(website|web ?page|homepage|browser|blog|url|http|www|online|app|banner|hero|page)\b/i, 'Looks like a web page']
  ];
  const LABEL = { web: 'Web', social: 'Social', print: 'Print', commercial: 'Commercial' };
  function inferUse(text, hint) {
    for (const [kind, re, reason] of RULES) if (re.test(text || '')) return { kind, label: LABEL[kind], reason };
    if (LABEL[hint]) return { kind: hint, label: LABEL[hint], reason: 'The picture suggests ' + hint + ' use' };
    return { kind: 'web', label: LABEL.web, reason: 'No clear sign of where it appears, so web is assumed' };
  }

  const MEDIUM_LABEL = { website: 'Web', social: 'Social', print: 'Print' };
  const TERM_LABEL = n => (n % 12 === 0 ? (n / 12) + (n === 12 ? ' year' : ' years') : n + (n === 1 ? ' month' : ' months'));
  const today = () => new Date().toISOString().slice(0, 10);

  // A first offer sized to the kind of use, kept inside what the work's published policy allows.
  function defaultOffer({ work, use, who, where }) {
    const wanted = { web: 'website', social: 'social', print: 'print', commercial: 'print' }[use?.kind] || 'website';
    const permitted = work.permitted || ['website'];
    const medium = permitted.includes(wanted) ? wanted : permitted[0];
    const maxTerm = work.maxTermMonths || 12;
    const termMonths = Math.min(medium === 'social' ? 6 : 12, maxTerm);
    const copies = medium === 'print' ? Math.min(use?.kind === 'commercial' ? 1000 : 500, work.maxCopies || 0) : 0;
    return { assetId: work.id, kind: use?.kind || 'web', medium, copies, termMonths, territory: work.territory || 'Worldwide',
      licensee: String(who || '').trim().slice(0, 100), project: ('Use on ' + (where || 'their page')).slice(0, 100), startsOn: today(), attribution: true, exclusive: false, training: false };
  }
  const toRequest = o => ({ assetId: o.assetId, project: o.project, licensee: o.licensee || 'Unnamed publisher', medium: o.medium, copies: o.medium === 'print' ? o.copies : 0,
    exclusive: false, training: false, attribution: o.attribution !== false, termMonths: o.termMonths, territory: o.territory, startsOn: o.startsOn });

  const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5 };
  const num = s => (/^\d+$/.test(s) ? Number(s) : WORDS[String(s).toLowerCase()]);
  const PLACES = [['united kingdom', 'United Kingdom'], ['uk', 'United Kingdom'], ['united states', 'United States'], ['usa', 'United States'], ['us', 'United States'], ['europe', 'Europe'], ['eu', 'European Union'], ['canada', 'Canada'], ['australia', 'Australia'], ['germany', 'Germany'], ['france', 'France'], ['worldwide', 'Worldwide'], ['globally', 'Worldwide']];

  // Understand a short instruction such as "make it one year" or "social only, not print".
  function parseEdit(input, offer) {
    const text = ' ' + String(input || '').toLowerCase().replace(/[.!]+$/g, '') + ' ';
    const patch = {}, notes = [];
    const half = /\bhalf (?:a |an )?year\b/.test(text);
    const term = half ? ['', 'six', 'months'] : /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|\d+)\s*(?:-|\s)?(months?|years?|yrs?)\b/.exec(text);
    if (term) {
      let n = num(term[1]); if (/^y/.test(term[2])) n *= 12;
            if (Number.isFinite(n) && n >= 1 && n <= 120) { patch.termMonths = Math.round(n); notes.push('Length: ' + TERM_LABEL(Math.round(n))); }
    }
    const copies = /\b(\d[\d,]*)\s+(?:copies|prints|copy)\b/.exec(text);
    if (copies) { patch.copies = Number(copies[1].replace(/,/g, '')); patch.medium = 'print'; notes.push(patch.copies.toLocaleString('en-US') + ' copies'); }
    const MED = { website: 'web|website|online|digital', social: 'social|instagram|facebook|tiktok|posts?', print: 'print|printed|paper|magazine|booklet' };
    const negated = [];
    let rest = text;
    for (const [m, src] of Object.entries(MED)) {
      const neg = new RegExp('\\b(?:not|no|without|except|excluding|drop|remove)\\s+(?:the\\s+)?(?:' + src + ')\\b', 'g');
      if (neg.test(rest)) { negated.push(m); rest = rest.replace(neg, ' '); }
    }
    const picks = Object.entries(MED).filter(([, src]) => new RegExp('\\b(?:' + src + ')\\b').test(rest)).map(([m]) => m);
    if (picks.length && !patch.medium) patch.medium = picks[0];
    else if (!picks.length && negated.includes(offer.medium) && !patch.medium) patch.medium = ['website', 'social', 'print'].find(m => !negated.includes(m) && m !== offer.medium);
    if (patch.medium) notes.push('Use: ' + MEDIUM_LABEL[patch.medium]);
    for (const [needle, label] of PLACES) if (new RegExp('\\b' + needle + '\\b').test(text) && (/\b(in|only|within|for|territory|to)\b/.test(text) || needle === 'worldwide')) { patch.territory = label; notes.push('Territory: ' + label); break; }
    const priceHint = /\b(cheaper|discount|lower the price|free)\b/.test(text);
    if (priceHint) notes.push('Price follows the work\'s published rules; change the use or length to size it.');
    return { patch, notes, ok: Object.keys(patch).length > 0, hint: priceHint };
  }

  const money = cents => '$' + (cents / 100).toFixed(2);
  function describeUse(o) {
    return MEDIUM_LABEL[o.medium] + (o.medium === 'print' && o.copies ? ' · ' + o.copies.toLocaleString('en-US') + ' copies' : '') + ' · ' + TERM_LABEL(o.termMonths) + ' · ' + o.territory;
  }
  // A polite note the creator can send along with the link.
  function message({ offer, work, priceCents, url, creator }) {
    return 'Hi ' + (offer.licensee || 'there') + ',\n\nI came across "' + work.title + '" in ' + (offer.project.replace(/^Use on /, '') || 'your project')
      + ' and I am glad you chose it. I do not have a licence on file for this use, so I have set one up so everything is clear for both of us: ' + describeUse(offer).toLowerCase()
      + ', nonexclusive, with credit to me. It is ' + money(priceCents) + ' in total.\n\nYou can review and pay securely through PayPal here:\n' + url
      + '\n\nOnce it is paid you will receive the original file and a certificate of the exact terms. If the scope should be different, tell me and I will adjust it.\n\nThank you,\n' + (creator || 'The creator');
  }
  return { match, inferUse, defaultOffer, toRequest, parseEdit, describeUse, message, money, TERM_LABEL, MEDIUM_LABEL, today };
});
