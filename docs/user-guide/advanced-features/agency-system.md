# Agency

Agency turns a desire into reviewed, bounded work. It is not a second task queue: desire planning, approval, execution, and outcome review submit through the existing Work Coordinator and operator path.

## Open Agency

Select **Agency** in the left sidebar. Agency is restricted by account role, cognitive mode, trust, and safety policy. If access is denied, change the controlling policy rather than editing desire files directly.

The dashboard separates operational desires, all open records, items that need
your action, completed work, and archived history. **Agency lifecycle settings**
expose the profile's source, strength, decay, approval, capacity, and execution
controls.

Persisted user conversation turns are checked for durable wants only when the
Desire Agent is intentionally run manually, by Sleep Workflow, or by Robot
Autonomy. Saving or responding to a chat message does not run the Desire
System. Greetings, questions, quoted text, and transient commands already being
fulfilled should not create desires. The same source observation is applied
only once; a changed or newly observed source can reinforce an existing desire
instead of creating a duplicate.

## Desire Lifecycle

A desire can move through states such as:

1. **Nascent** — a low-strength, evidence-backed want is accumulating support.
2. **Pending, evaluating, or planning** — strength crossed the activation
   threshold and the existing Work Coordinator admitted planning.
3. **Questioning** — required planning context is missing. Answer the questions
   on the expanded desire card; planning resumes automatically.
4. **Reviewing** — the reviewer graph is checking the persisted plan.
5. **Awaiting approval** — review passed and active trust/risk policy requires
   explicit owner approval. A revision verdict returns to planning instead.
6. **Approved or executing** — execution has been admitted or is underway.
7. **Awaiting review** — execution ended and outcome review is queued.
8. **Needs attention** — retry limits or a non-approval problem require an owner
   decision. This state is not presented as a plan approval.
9. **Paused** — autonomous work is intentionally dormant but history is retained.
10. **Completed, rejected, abandoned, archived, or failed** — terminal history.

Status alone does not prove the intended outcome occurred. Review the execution record and outcome review.

## Create a Manual Desire

Choose **New Desire**, then provide a title, description, reason, and risk. Advanced options can set:

- one-time, recurring, or long-running goal type;
- initial strength and decay rate;
- nascent or pending start state;
- tags.

Creating a pending desire admits planning; it does not bypass plan review or
execute immediately. Creating a nascent desire waits for new evidence.

## Plan and Review

Use **Generate Plan** to request one targeted planning operation from the Desire
Agent. Its internal planner builds ordered steps from the registered capability catalog, validates the
result, runs persona-alignment and policy-safety review, records a review receipt
for that exact plan version, records its reflection, and then persists exactly
one result: clarification questions, rejection, revision required, approval
required, or policy-allowed auto-approval. Supervised mode always waits for
owner approval. Autonomous mode applies the configured trust, risk, and
desire-strength policy. A plan step marked as requiring approval cannot be
auto-approved unless the profile explicitly enables Agency YOLO mode. YOLO
bypasses approval gates after review; it does not skip the
alignment and safety review itself. If persistence is interrupted while a desire is `reviewing`, the
next Desire Agent run resumes that internal review and reuses any recorded receipt
instead of replacing it with a new decision. Plans are versioned. You can review
older versions, add critique, and regenerate instead of silently overwriting the
plan history.

The **Approve Plan** control appears only after the canonical reviewer reaches
`awaiting_approval`; it cannot skip planning or review. **Regenerate Plan** sends
the desire through the same planner and reviewer owner again. Approval means the
reviewed plan version is eligible for execution; it is not proof that work has
started.

## Execute and Review the Outcome

**Execute** submits the approved desire through the bounded operator path. An
automatic approval uses that same path. Execution completion admits outcome
review through the Work Coordinator. Retry and continue verdicts preserve the
lessons and return the same desire to planning; exceeding the retry limit enters
**Needs attention**. You can still run these stages manually for recovery.

Keep these distinctions:

- a generated plan is a proposal;
- approval is authorization;
- queue admission is not completion;
- terminal execution is not necessarily a successful outcome;
- outcome review is model analysis, not external proof.

For an external or physical action, confirm the result in the target system or device.

## Long-Running Desires

Long-running desires can include milestones, linked tasks, progress, and check-in times. Their repeated work is admitted through the Desire Agent and the existing coordinator. Do not create a separate scheduler for a desire.

## Existing Data Migration

The explicit migration is dry-run by default:

```bash
pnpm migrate:agency --username=<profile>
pnpm migrate:agency --username=<profile> --apply
```

Apply mode writes an inert timestamped backup before replacing each manifest.
It normalizes legacy statuses, sources, metrics, stages, folder references, and
decay timestamps. It reports exact-title/source duplicates but does not guess
which record to delete. Above-threshold legacy strength without traceable
evidence is held for owner review instead of silently starting autonomous work.

## Related Guides

- [Tasks and Projects](/user-guide#task-management)
- [Autonomous Work](/user-guide#autonomous-agents)
- [Security and Trust](/user-guide#security-trust)
- [Dashboard and Monitoring](/user-guide#dashboard-monitoring)
