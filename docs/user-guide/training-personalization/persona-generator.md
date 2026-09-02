# Persona Generator

The Persona Generator conducts a profile-scoped interview and proposes structured persona changes. It does not silently replace the active persona: you review the extracted changes and choose how to apply them.

## Open the Generator

Select **Persona** in the left sidebar, then **Generator**. During first-run onboarding, the same interview flow is available as the full-interview personality option.

The generator requires a configured, available language-model backend for adaptive questions and extraction.

## Start or Resume an Interview

Choose **Start New Interview** to create a session. If an unfinished session is found, the page offers **Resume Interview** or **Start Fresh**. Session history shows active, completed, finalized, applied, and aborted sessions with the actions available for each state.

The interview normally asks 7–15 adaptive questions and tracks coverage across values, goals, communication style, biography, and current focus.

For each question:

1. enter a substantive answer;
2. choose **Submit Answer** or press Ctrl+Enter;
3. review the new coverage and next question;
4. use **Edit Response** if a previous answer is inaccurate.

**Pause** leaves the session available for later. **Discard** marks the current session as aborted after confirmation.

## Quick Add Notes

**Add Notes to Persona** sends free-form observations through the extraction and merge owner without a full interview. This is convenient for a focused update, but it is still model-generated interpretation. Review the resulting persona in the Editor afterward.

## Finalize and Review

When the interview reaches completion, the generator extracts a proposed persona and opens **Review Persona Changes**. The dialog shows:

- additions and updates;
- extraction confidence;
- a summary or full diff;
- the extracted data;
- the apply strategy.

Review the actual field changes before applying them.

## Apply Strategies

- **Merge** updates mentioned fields while preserving unrelated existing data. This is the normal choice.
- **Append** adds new information alongside existing data without intentionally removing it.
- **Replace** replaces the existing persona with the extracted result. Use it only when that destructive scope is intended.

Applying a session updates the active profile and records the session as applied. The CLI path creates a timestamped backup before writing. In the web UI, confirm an archive exists rather than assuming one was made.

## CLI Interview Workflow

Every persona CLI command requires an explicit registered user:

```bash
# Inspect current persona and adapter state
./bin/mh --user USERNAME persona status

# Start or resume
./bin/mh --user USERNAME persona generate
./bin/mh --user USERNAME persona generate --resume

# Inspect sessions
./bin/mh --user USERNAME persona sessions
./bin/mh --user USERNAME persona view SESSION_ID

# Apply a completed session
./bin/mh --user USERNAME persona apply SESSION_ID merge
```

Valid apply strategies are `merge`, `append`, and `replace`.

To abort a session or clean old inactive sessions:

```bash
./bin/mh --user USERNAME persona discard SESSION_ID
./bin/mh --user USERNAME persona cleanup --dry-run --max-age 30
./bin/mh --user USERNAME persona cleanup --max-age 30
```

Run the cleanup dry run first. Cleanup targets old aborted, completed, finalized, and applied sessions and archives them before deletion through the existing owner.

## Owner Actions in the Web UI

The generator exposes destructive owner actions for purging all interview sessions and resetting the persona file. These actions cannot be inferred from ordinary editing permission. Read the confirmation dialog and use them only when permanent removal or reset is the intended result.

## What the Generator Does Not Do

- It does not train a model or create a LoRA adapter.
- It does not change the cognitive mode or active backend.
- It does not make extracted statements automatically true.
- It does not make private profile data safe to commit.

Evaluate the applied persona in a new conversation. If only a field needs correction, use the [Persona Editor](/user-guide#persona-editor) rather than starting another broad interview.

## Related Guides

- [Persona Editor](/user-guide#persona-editor)
- [Cognitive Modes](/user-guide#cognitive-modes)
- [AI Training](/user-guide#ai-training)
- [Accounts and Security](/user-guide#accounts-security)
