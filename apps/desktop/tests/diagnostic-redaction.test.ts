import { describe, expect, it } from 'vitest';

import { redactDiagnosticText } from '../src/diagnostic-redaction.js';

describe('redactDiagnosticText', () => {
  it('masque les chemins personnels en privilégiant le chemin le plus précis', () => {
    const diagnostic = JSON.stringify({
      extensionPath: 'C:\\Users\\Hao\\AppData\\Roaming\\SubTranslateAI\\extension',
      error: 'Échec dans C:\\Users\\Hao\\Downloads\\model.gguf',
    });

    const redacted = redactDiagnosticText(diagnostic, [
      { value: 'C:\\Users\\Hao', replacement: '<USER_HOME>' },
      {
        value: 'C:\\Users\\Hao\\AppData\\Roaming\\SubTranslateAI',
        replacement: '<APP_DATA>',
      },
    ]);

    expect(redacted).toContain('<APP_DATA>\\\\extension');
    expect(redacted).toContain('<USER_HOME>\\\\Downloads');
    expect(redacted).not.toContain('Hao');
  });

  it('ignore une valeur vide et remplace sans tenir compte de la casse', () => {
    expect(
      redactDiagnosticText('C:\\USERS\\HAO\\file', [
        { value: '', replacement: '<EMPTY>' },
        { value: 'c:\\users\\hao', replacement: '<HOME>' },
      ]),
    ).toBe('<HOME>\\file');
  });
});
