# WiKahon project agents

The Next.js AAC app lives in `seals/`. Read [seals/AGENTS.md](seals/AGENTS.md) for the app rules and MVVM boundaries, including when starting from the repository root.

Choose the role matching the assignment. The Codex names below use underscores. Claude Code, Gemini CLI, and Antigravity use hyphens.

| Agent | Assignment |
| --- | --- |
| `architect` | Plan cross-layer changes, contracts, and acceptance criteria. |
| `frontend_builder` | Implement Next.js routes, AAC views, and headless ViewModels. |
| `backend_builder` | Implement server actions, services, and Supabase persistence. |
| `code_explorer` | Trace a user action or symptom through the MVVM layers and persistence. |
| `code_reviewer` | Review a diff for regressions, contract drift, and data consistency. |
| `security_auditor` | Review session, role, and data-access boundaries. |
| `test_engineer` | Verify existing flows and report observed results using existing checks. |
| `ux_auditor` | Review AAC interaction, accessibility, and recovery. |
| `docs_researcher` | Verify project behavior and version-matched documentation. |
| `technical_writer` | Update assigned documentation with verified project terminology and commands. |

For delegated implementation, give builders non-overlapping files and share the agreed contract across layers. Use Gemini 4 Hydrogen at High effort for implementation workers in Antigravity when available. The Antigravity profiles inherit the selected session model.

- Codex reads agents from `.codex/agents/`.
- Claude Code reads agents from `.claude/agents/`.
- Gemini CLI reads agents from `.gemini/agents/` and imports this file through `GEMINI.md`.
- Antigravity reads agents from `.agents/agents/`. Use the agent selector in the app or `agy agents` in the CLI to see the available roles.

## Project skills

The four project skills live under `.agents/skills/`, shared by Codex, Gemini CLI, and Antigravity. The table uses Codex's `$` syntax. In Gemini CLI, use `/skills list` and request the skill by name. In Antigravity, invoke a skill with `/<name>`.

| Skill | Use |
| --- | --- |
| `$graphify` | Query the existing repository graph for code and architecture questions. |
| `$repowise` | Look up indexed file or symbol context, wiki entries, and recorded decisions when a local index is available. |
| `$wikahon-obsidian` | Browse or refresh the Graphify Obsidian export. |
| `$paul` | Plan, apply, and reconcile phased implementation or handoffs. |
| `$seed` | Capture a new project idea or hand an approved brief off to a build workspace. |

Run Graphify from the repository root. If `graphify-out/graph.json` exists, start cross-layer research with `graphify query "<question>"`. Use `graphify path "<start>" "<end>"` for relationships and `graphify explain "<symbol>"` for a specific symbol. Verify relevant results in source. If the graph or CLI is unavailable, use `rg` and Git. Run `graphify update .` after changing application code.
