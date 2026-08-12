import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface ShutdownCommand {
  executable: string;
  args: readonly string[];
}

export function ollamaShutdownCommands(
  ollamaExecutable: string | null,
  model: string,
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
): readonly ShutdownCommand[] {
  const commands: ShutdownCommand[] = [];
  if (platform === 'win32') {
    const taskkill = systemRoot ? join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
    commands.push(
      { executable: taskkill, args: ['/IM', 'ollama app.exe', '/T', '/F'] },
      { executable: taskkill, args: ['/IM', 'ollama.exe', '/T', '/F'] },
      { executable: taskkill, args: ['/IM', 'llama-server.exe', '/T', '/F'] },
    );
  } else if (ollamaExecutable) {
    commands.push({ executable: ollamaExecutable, args: ['stop', model] });
  }
  return commands;
}

export async function stopOllamaProcesses(
  ollamaExecutable: string | null,
  model: string,
): Promise<void> {
  await Promise.all(
    ollamaShutdownCommands(ollamaExecutable, model).map((command) =>
      runIgnoringFailure(command, 4_000),
    ),
  );
}

export function ollamaStartupShortcutPaths(appData: string): {
  active: string;
  disabled: string;
} {
  const startupDirectory = join(
    appData,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
  );
  return {
    active: join(startupDirectory, 'Ollama.lnk'),
    disabled: join(startupDirectory, 'Ollama.lnk.disabled'),
  };
}

export async function disableOllamaLaunchAtLogin(
  appData = process.env.APPDATA,
  platform = process.platform,
): Promise<boolean> {
  if (platform !== 'win32' || !appData) return false;
  const paths = ollamaStartupShortcutPaths(appData);
  const removals = await Promise.all(
    [paths.active, paths.disabled].map(async (path) => {
      try {
        await rm(path);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return removals.some(Boolean);
}

async function runIgnoringFailure(command: ShutdownCommand, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    const child = spawn(command.executable, [...command.args], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore',
    });
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish();
    }, timeoutMs);
    child.once('error', finish);
    child.once('exit', finish);
  });
}
