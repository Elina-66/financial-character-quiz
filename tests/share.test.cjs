const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const shareSource = source.slice(source.indexOf('async function shareQuiz(){'), source.indexOf('function renderEmailForm(){'));
function setup(navigator) {
  const status = { textContent: '' };
  const button = { disabled: false };
  const field = { hidden: true, focus() { this.focused = true; }, select() { this.selected = true; } };
  const elements = { '#share-status': status, '#share': button, '#share-link': field };
  const share = vm.runInNewContext(shareSource + '\nshareQuiz', {
    URL, navigator, window: { location: { href: 'https://quiz.example.com/?private=value#state' } },
    app: { querySelector: selector => elements[selector] }, quizData: { title: 'Квиз' }
  });
  return { share, status, button, field };
}
test('clipboard sharing copies the quiz URL without query or fragment', async () => {
  let copied;
  const state = setup({ clipboard: { writeText: async value => { copied = value; } } });
  await state.share();
  assert.equal(copied, 'https://quiz.example.com/');
  assert.match(state.status.textContent, /Ссылка скопирована/);
  assert.equal(state.button.disabled, false);
});
test('native sharing opens the share sheet with the quiz link', async () => {
  let payload;
  const state = setup({ share: async value => { payload = value; } });
  await state.share();
  assert.equal(payload.url, 'https://quiz.example.com/');
  assert.equal(state.status.textContent, '');
  assert.equal(state.button.disabled, false);
});
test('cancelling sharing leaves the form usable and does not copy anything', async () => {
  const state = setup({ share: async () => { const error = new Error(); error.name = 'AbortError'; throw error; } });
  await state.share();
  assert.equal(state.status.textContent, '');
  assert.equal(state.field.hidden, true);
  assert.equal(state.button.disabled, false);
});
test('blocked native sharing and clipboard expose a selectable link', async () => {
  const state = setup({ share: async () => { throw new Error('blocked'); } });
  await state.share();
  assert.equal(state.field.value, 'https://quiz.example.com/');
  assert.equal(state.field.hidden, false);
  assert.equal(state.field.selected, true);
  assert.equal(state.button.disabled, false);
});
