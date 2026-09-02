# Setup and First Login

This chapter covers the first authenticated session on a running MetaHuman OS
installation.

## Open the application

For a default local installation, open:

```text
http://127.0.0.1:4321
```

For a remote installation, use the HTTPS address supplied by its owner. Do not
expose the local listener publicly without completing
[Deployment and Remote Access](/user-guide#deployment).

## Create the first account

Choose **Create Account** and provide:

- a username containing letters, numbers, underscores, or hyphens;
- an optional display name and email address;
- a password of at least six characters;
- confirmation of the Terms of Service and Ethical Use Policy.

The first registered account becomes the installation owner. Later registrations
do not automatically receive owner authority.

After registration, save all ten recovery codes in a password manager or another
secure offline location. They are shown as part of account creation and each code
is single-use. A password reset invalidates the old set and returns a replacement
set.

Do not place recovery codes in the repository, screenshots, support reports, or
profile notes.

## Choose onboarding or direct entry

The optional onboarding wizard has five steps:

1. Review the welcome and data-boundary information.
2. Build a personality through the full interview, quick survey, or skip option.
3. Import optional context through the maintained ingestion path.
4. Add optional goals.
5. Review and complete onboarding.

Progress is stored in the account profile, so an interrupted wizard can resume.
Skipping is explicit and does not prevent later persona editing, memory capture,
file ingestion, or goal creation.

After onboarding:

- use **Persona → Editor** to edit identity and facets;
- use **Persona → Generator** for a guided interview;
- use **Persona → Memory** to inspect stored profile material;
- use **Projects** to manage tasks and projects.

## Sign in again

Choose **Sign In**, enter the username and password, and submit. A successful
login creates an authenticated session and resolves that user's profile paths.

If encrypted profile storage is configured, login may also unlock it. The
application must not create a usable session when profile readiness or unlock
fails.

Use **Forgot password?** with one unused recovery code to reset a password. Save
the replacement codes returned by the reset.

## Guest access

**Continue as Guest** creates a real authenticated guest-role session; it is not
anonymous access.

A guest session:

- lasts one hour;
- is read-only;
- is restricted to public profiles selected through the profile chooser;
- cannot use owner-only controls;
- is locked to the Emulation cognitive mode. The guest role, rather than the
  mode label alone, supplies the read-only boundary.

If no public profile is available, guest access cannot expose a private profile.
The owner controls profile visibility.

## Sync an existing profile

Use **Sync from Server** when this device has no local copy of an account that
already exists on another MetaHuman server.

Provide the server URL, username, and password. The bootstrap authenticates
against that server, creates the missing local profile, then queues the canonical
Profile Sync agent. Later authenticated sync operations use the same bounded
profile-sync owner and checkpointed memory persistence.

A successful login to the remote server is not by itself proof that every local
profile item reconciled. Review the sync result and local profile before relying
on it.

See [Accounts and Security](/user-guide#accounts-security) for
storage, encryption, and sync boundaries.

## Confirm model availability

Open **System → Backend** and inspect the selected backend. Then inspect the
model-role status in the left sidebar.

For CLI inspection:

```bash
./bin/mh backend status
./bin/mh backend detect
```

For an Ollama installation:

```bash
./bin/mh ollama status
./bin/mh ollama list
```

Use `./bin/mh ollama pull MODEL` only for a model you have deliberately
selected. Do not copy an old guide's hardcoded model name into a current
installation.

Semantic indexing uses the maintained embedding owner. Do not configure a second
embedding service merely because the first index is empty; follow
[Memory System](/user-guide#memory-system) and inspect the visible
failure state.

## First-use walkthrough

### 1. Send a chat turn

Open **Chat**, select the intended cognitive mode, and send a simple message.
Confirm that the visible turn finishes or reports a clear failure.

Conversation-buffer persistence is distinct from long-term episodic memory. A
chat response does not prove that every statement became a long-term memory.

### 2. Capture a known memory

Use an explicit capture so the expected result is unambiguous:

```bash
./bin/mh --user USERNAME capture "Testing explicit memory capture on this installation"
```

Open **Persona → Memory → Episodic** and confirm that the entry is present under
the logged-in profile.

### 3. Search the memory

```bash
./bin/mh --user USERNAME remember "explicit memory capture"
```

Keyword results and semantic-index results are different evidence. If semantic
search reports a missing or legacy index, use the documented index rebuild path
rather than creating another index.

### 4. Create a task

Open **Dashboard → Tasks**, create a small task, and move it through its intended status.
The CLI alternative is:

```bash
./bin/mh --user USERNAME task add "Review the MetaHuman User Guide"
./bin/mh --user USERNAME task
```

### 5. Inspect work and services

- Open the right-side **Queue** to see admitted finite work and terminal history.
- Owners can open **Agent Monitor** to inspect persistent services.
- Open **Server Status** to inspect model and voice service availability.
- Open **Dashboard → Agent Catalog** to see installed, registered, workflow-child,
  and persistent-service entries.
- Open **Dashboard → Trigger Manager** before enabling scheduled work.

Do not infer execution from registration or a configured schedule. Confirm the
work item and terminal result.

## Optional next steps

- Configure speech through [Voice Features](/user-guide#voice-features).
- Configure model routing through
  [LLM Backend Configuration](/user-guide#llm-backend).
- Build a persona through
  [Persona Generator](/user-guide#persona-generator).
- Review autonomy through
  [Autonomous Work](/user-guide#autonomous-agents).
- Configure remote access through
  [Deployment and Remote Access](/user-guide#deployment).
