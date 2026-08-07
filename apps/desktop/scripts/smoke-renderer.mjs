const port = Number(process.argv[2] ?? 9223);
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === 'page');
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
const sameSettings = JSON.stringify({
  automaticUpdates: true,
  launchAtLogin: true,
  requestTimeoutMs: 45_000,
  maxRetries: 1,
  memoryCacheEntries: 1_000,
});
const savedControlPanel = await evaluate(`window.subTranslate.saveControlPanel(${sameSettings})`);
const output = {
  heading: await evaluate('document.querySelector("h2")?.textContent'),
  status: await evaluate('window.subTranslate.getStatus()'),
  controlPanel,
  settingsSaved: savedControlPanel.serverSettings,
  update: await evaluate('window.subTranslate.getUpdateStatus()'),
};
socket.close();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
