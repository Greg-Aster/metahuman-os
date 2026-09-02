# Memory

MetaHuman OS keeps durable memory per resolved profile. Episodic records, task records, processed artifacts, and the semantic index have different purposes; chat buffers are not a substitute for durable capture.

## Open the Memory Surface

Select **Persona** in the left sidebar, then **Memory**. The available views are:

- **Episodic** — captured events and conversations.
- **Reflections** — retained reflective output.
- **Tasks** — profile task records.
- **Curated** — training-suitable records produced by curation.
- **Inbox Imports** — files staged for the generic inbox ingestor.
- **Audio** — completed transcripts and organized audio-derived records.
- **Dreams** — retained dream output.
- **Curiosity** — curiosity questions and research records.
- **Functions** — draft or verified reusable workflows.

The data shown depends on the active profile and the account's access.

## Capture a Memory

Use explicit capture for information that should become a durable episodic record:

```bash
./bin/mh --user USERNAME capture "The design review moved to Thursday"
```

Omit `--user` only when the CLI can resolve one unambiguous authenticated
profile.

Do not assume that visible chat history has become durable memory unless the owning workflow explicitly captured it.

## Search Memory

The simplest command is:

```bash
./bin/mh --user USERNAME remember "design review"
```

When a compatible semantic index is ready, `remember` uses it. If semantic search fails or no usable index exists, the CLI reports that condition and uses its separate keyword search.

For a direct semantic query:

```bash
./bin/mh --user USERNAME index query "what changed about the design review?"
```

Search results are evidence that matching records were retrieved, not that every relevant memory exists or that an answer inferred from them is correct.

## Build or Repair the Search Index

The Memory controls show whether the active profile's index is **Ready**, **Missing**, **Legacy**, or **Corrupt**. Use **Queue rebuild** to submit a profile-scoped rebuild through the Work Coordinator. The same operation is available from the CLI:

```bash
./bin/mh --user USERNAME index build
```

The command queues work; it does not wait for the rebuild to finish. Check Queue for the terminal result, then refresh the Memory index status. The configured embeddings backend and profile storage must be available while the job runs. Encrypted profiles are read through the existing profile and encryption owners rather than through a plaintext side path.

## Import Text Files

Stage a supported file or a directory's first-level files in the active profile inbox:

```bash
./bin/mh --user USERNAME ingest /path/to/notes.md
./bin/mh --user USERNAME agent run ingestor
```

The generic Inbox Ingestor accepts UTF-8 `.txt`, `.md`, and `.json` files within its configured file-size and chunk limits. It is installed but not scheduled by default. You can also run it from **System → Agent Catalog** after placing files in the profile inbox.

PDF and DOCX documents are not generic inbox formats. Route them through the maintained document-ingestion feature when that interface is configured.

Repeated ingestion uses the memory owner's retry and deduplication contract. Inspect the job's per-file and per-chunk outcome if a run partially succeeds or fails; do not assume that copying a file to the inbox means it was captured or archived.

## Organize and Curate

The Memory controls provide manual runs for two separate functions:

- **Memory Organizer** enriches existing memories with tags and entities to improve retrieval.
- **Training Curator** evaluates records for training suitability and prepares clean training material.

These jobs submit through Trigger Manager and the Work Coordinator. A successful submission means the job was admitted; inspect Queue or Agent Monitor for completion.

## Profile Storage

Never construct a profile path from a username. Profiles can use internal, external, or encrypted storage, and the configured storage owner resolves the real location. Use the web UI and CLI for normal operations. Owners who need storage administration should follow [Accounts and Security](/user-guide#accounts-security).

Memory, indexes, inbox files, transcripts, and derived artifacts are private runtime data. Do not commit them to the repository.

## Related Guides

- [Tasks and Projects](/user-guide#task-management)
- [Voice Training and Audio Data](/user-guide#voice-training)
- [AI Training](/user-guide#ai-training)
- [Accounts and Security](/user-guide#accounts-security)
