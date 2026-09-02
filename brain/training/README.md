# Training

`brain/training` contains two finite, explicitly launched training systems. They
share this umbrella because both produce model artifacts, but they do not share
datasets, scheduling, ownership, or deployment decisions.

- `personalization/` builds profile-owned datasets from the canonical Curator
  store and launches local LoRA, remote LoRA, or full fine-tuning. The Training
  Wizard and automatic-training policy share the one Core launch owner. Nothing
  in this directory schedules itself; Sleep Workflow admission has not yet been
  installed.
- `environment-action-selector/` owns the sanitized system dataset, independent
  folds, evaluation, scoring, and export for the environment action selector.
  Its candidates are not deployed automatically.

Generated runs belong under ignored output/profile locations, not in this source
tree. See each subfolder's README or the user training guide for commands.
