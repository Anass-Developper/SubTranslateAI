# Contributing to SubTranslateAI

Thanks for helping make local bilingual subtitles more reliable.

## Before opening an issue

- Search existing issues first.
- Use the bug template and attach the copied diagnostic report when relevant.
- Remove usernames, file paths or subtitle text you do not want to share.
- Never publish API keys, tokens, full copyrighted subtitle files or account information.

## Development setup

You need Node.js 20.18 or newer, npm 10.8 or newer, and Ollama for live translation tests.

```powershell
git clone https://github.com/Anass-Developper/SubTranslateAI.git
cd SubTranslateAI
npm ci
Copy-Item .env.example apps/local-server/.env
npm run check
```

Unit tests do not require a running Ollama instance. For a live test, install the model with:

```powershell
ollama pull hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M
```

## Pull requests

1. Keep each pull request focused on one problem.
2. Add or update tests for behavior changes.
3. Run `npm run check` before submitting.
4. Explain user-visible changes and any security or privacy impact.
5. Use only original, synthetic or freely licensed subtitle samples.

By submitting a contribution, you agree that it is licensed under Apache-2.0, as described in the repository license.

Good first contributions include documentation fixes, synthetic subtitle fixtures, accessibility improvements and isolated website-adapter fixes.
