'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const found = require('../public/found-offer.js');

const works = [
  { id: 'the-tidal-archive', title: 'The Tidal Archive', description: 'A library above the turning tide, reached by a single causeway.', kind: 'Editorial illustration', permitted: ['website', 'social', 'print'], maxCopies: 5000 },
  { id: 'the-last-light', title: 'The Last Light', description: 'A keeper descends the basalt headland while a boat follows the last light home.', kind: 'Editorial illustration', permitted: ['website', 'social', 'print'], maxCopies: 5000 }
];

test('matches a description to the creator\'s own works', () => {
  assert.equal(found.match('a library on a causeway above the tide', works)[0].id, 'the-tidal-archive');
  assert.equal(found.match('a keeper walking a headland with a boat', works)[0].id, 'the-last-light');
  assert.equal(found.match('a photo of a dog', works)[0].score, 0);
});

test('reads the kind of use', () => {
  assert.equal(found.inferUse('a square post with likes on instagram').kind, 'social');
  assert.equal(found.inferUse('a printed exhibition guide booklet').kind, 'print');
  assert.equal(found.inferUse('product page with add to cart').kind, 'commercial');
  assert.equal(found.inferUse('hero on a museum website').kind, 'web');
  assert.equal(found.inferUse('unclear', 'social').kind, 'social');
});

test('sizes the first offer to the use and the work\'s policy', () => {
  const o = found.defaultOffer({ work: works[0], use: { kind: 'print' }, who: 'Museum', where: 'a guide' });
  assert.equal(o.medium, 'print'); assert.equal(o.copies, 500);
  const s = found.defaultOffer({ work: works[0], use: { kind: 'social' }, who: '', where: '' });
  assert.equal(s.medium, 'social'); assert.equal(s.termMonths, 6); assert.equal(s.copies, 0);
  const limited = found.defaultOffer({ work: { ...works[0], permitted: ['website'] }, use: { kind: 'print' } });
  assert.equal(limited.medium, 'website');
});

test('applies a typed change', () => {
  const o = { medium: 'print', termMonths: 12 };
  assert.deepEqual(found.parseEdit('make it one year', o).patch, { termMonths: 12 });
  assert.deepEqual(found.parseEdit('six months', o).patch, { termMonths: 6 });
  assert.deepEqual(found.parseEdit('social only, not print', o).patch, { medium: 'social' });
  assert.equal(found.parseEdit('no print', o).patch.medium, 'website');
  assert.equal(found.parseEdit('half a year', o).patch.termMonths, 6);
  assert.equal(found.parseEdit('500 copies in the UK', o).patch.territory, 'United Kingdom');
  assert.equal(found.parseEdit('banana', o).ok, false);
});
