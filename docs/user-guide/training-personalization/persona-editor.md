# Persona Editor

The Persona Editor changes the active profile's structured identity directly. Use it for precise edits. Use the [Persona Generator](/user-guide#persona-generator) when you want an interview to propose broader changes.

## Open the Editor

Select **Persona** in the left sidebar, then **Editor**. The editor loads the current profile and provides four areas:

- **Core Identity** — identity, personality, values, goals, context, and advanced fields.
- **Facets** — optional named variations with their own metadata and persona file.
- **Insights** — read-only derived persona insights when available.
- **Archives** — previous persona snapshots that can be viewed, restored, or deleted.

If the active account cannot write the profile, editing actions are unavailable or rejected by the API.

## Edit Core Identity

Core Identity is divided into six tabs:

- **Identity** — AI name, human name, email, icon path, role, purpose, and aliases.
- **Personality** — communication style, narrative style, Big Five values when present, archetypes, aesthetic, and interests.
- **Values** — prioritized core values and boundaries.
- **Goals** — short-, mid-, and long-term goals with the status options supported by each group.
- **Context** — domains, current projects, and current focus.
- **Advanced** — decision heuristics, writing style, background, and notes.

Review the active tab carefully, then choose **Save Core Identity**. Changes are not saved merely because you changed tabs or navigated away.

### Lists and Structured Entries

Some lists use one entry per line. Values, goals, projects, and decision heuristics use repeatable structured cards. Remove an entry only when you intend it to be absent from the saved persona.

The editor validates through the profile API. Prefer this interface to editing `core.json` directly so profile resolution, schema handling, and storage policy remain intact.

## Manage Facets

The Facets tab lets you:

- add or remove a facet;
- change its name and description;
- assign a persona file and display color;
- enable or disable it;
- maintain usage hints.

Choose **Save Facets** after editing. A facet configuration does not train or activate a model adapter; it changes persona presentation and selection data.

## Review Insights

The Insights tab displays derived persona information when the profile has an insights record. Refresh it after a workflow updates those insights. Treat the displayed data as a generated interpretation to review, not as an unquestionable fact about the person.

## Work with Archives

The Archives tab lists snapshots known to the persona archive API. You can:

- **View** the snapshot;
- **Restore** it as the active persona;
- **Delete** it permanently.

Persona update workflows can create backups before applying changes, but do not assume every edit has an archive until the archive list shows one. Review a snapshot before restoring it; restoring replaces the active persona state.

## Verify a Change

After saving or restoring:

1. confirm the editor reports success;
2. reload the editor and verify the stored values;
3. start a new Chat turn if you need to evaluate conversational behavior.

A saved persona proves that profile data changed. It does not prove that every backend will express the change strongly, nor does it retrain or switch the active model.

The CLI can show the profile's current persona and adapter state:

```bash
./bin/mh --user USERNAME persona status
```

## Privacy

Persona identity, interview content, archives, and insights are private profile data. Do not commit them or paste sensitive details into repository documentation.

## Related Guides

- [Persona Generator](/user-guide#persona-generator)
- [Cognitive Modes](/user-guide#cognitive-modes)
- [Accounts and Security](/user-guide#accounts-security)
- [AI Training](/user-guide#ai-training)
