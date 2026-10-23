/* global DEFAULT_SERVER */
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(['server', 'token']).then(({ server = DEFAULT_SERVER, token = '' }) => {
  $('server').value = server;
  $('token').value = token;
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let server = $('server').value.trim().replace(/\/+$/, '') || DEFAULT_SERVER;
  if (!/^(https:\/\/[\w.-]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/.test(server)) {
    alert('The address must look like ' + DEFAULT_SERVER);
    return;
  }
  await chrome.storage.local.set({ server, token: $('token').value.trim() });
  $('saved').hidden = false;
  setTimeout(() => { $('saved').hidden = true; }, 2000);
});
