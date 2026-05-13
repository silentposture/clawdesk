# AI Agent Host-Operation Risk Notice Draft

ClawDesk can coordinate local tools, files, browser sessions, models, and workflow automation. Agent output can be wrong, incomplete, unsafe, or costly. Users should review permission prompts before allowing file changes, network calls, credential use, deletions, or external submissions.

Recommended Beta limits:

- Keep destructive actions behind explicit approval.
- Keep diagnostics redacted by default.
- Avoid storing plaintext secrets in prompts, logs, diagnostics, or license state.
- Maintain workspace backups before running broad agent tasks.
- Do not use the Beta for regulated advice, financial recommendations, medical decisions, or safety-critical operations.
