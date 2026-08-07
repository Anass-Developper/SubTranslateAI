const port = Number(process.argv[2] ?? 9223);
const deadline = Date.now() + 20_000;
let page;
while (!page && Date.now() < deadline) {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json(),
  );
  page = pages.find((candidate) => candidate.type === 'page');
  if (!page) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}
if (!page?.webSocketDebuggerUrl) throw new Error('Fenêtre Electron introuvable via CDP.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolvePromise, reject) => {
  socket.addEventListener('open', resolvePromise, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
async function evaluate(expression) {
  const id = ++nextId;
  const result = await new Promise((resolvePromise, reject) => {
    const onMessage = (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (payload.error) reject(new Error(payload.error.message));
      else resolvePromise(payload.result);
    };
    socket.addEventListener('message', onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const controlPanel = await evaluate('window.subTranslate.getControlPanel()');
await evaluate('document.querySelector(`[data-page-target="settings"]`)?.click()');
const selectedTimeout = await evaluate(`(() => {
  const select = document.querySelector('#request-timeout');
  select.value = '90000';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()`);
await new Promise((resolvePromise) => setTimeout(resolvePromise, 21_000));
const selectedTimeoutAfterRefresh = await evaluate(
  'document.querySelector("#request-timeout")?.value',
);
const settingsMessage = await evaluate('document.querySelector("#settings-message")?.textContent');
const sameSettings = JSON.stringify({
  automaticUpdates: true,
  launchAtLogin: true,
  requestTimeoutMs: 45_000,
  maxRetries: 1,
  memoryCacheEntries: 1_000,
});
let savedControlPanel = null;
let settingsSaveError = null;
try {
  savedControlPanel = await evaluate(`window.subTranslate.saveControlPanel(${sameSettings})`);
} catch (error) {
  settingsSaveError = error instanceof Error ? error.message : String(error);
}
const output = {
  heading: await evaluate('document.querySelector("h2")?.textContent'),
  status: await evaluate('window.subTranslate.getStatus()'),
  controlPanel,
  selectedTimeout,
  selectedTimeoutAfterRefresh,
  settingsMessage,
  settingsSaved: savedControlPanel?.serverSettings ?? null,
  settingsSaveError,
  update: await evaluate('window.subTranslate.getUpdateStatus()'),
};
socket.close();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
