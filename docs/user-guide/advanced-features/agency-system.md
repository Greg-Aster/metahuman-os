# Agency

Agency turns a desire into reviewed, bounded work. It is not a second task queue: desire planning, approval, execution, and outcome review submit through the existing Work Coordinator and operator path.

## Open Agency

Select **Agency** in the left sidebar. Agency is restricted by account role, cognitive mode, trust, and safety policy. If access is denied, change the controlling policy rather than editing desire files directly.

The dashboard summarizes generated, completed, rejected, abandoned, and failed desires. Filters group active, waiting, completed, and failed states.

## Desire Lifecycle

A desire can move through states such as:

1. **Nascent or pending** — an idea exists but has not been approved for work.
2. **Evaluating and planning** — the system reviews the desire and builds a versioned plan.
3. **Reviewing** — the plan and its risk are awaiting review.
4. **Approved** — execution is allowed, but may not yet be admitted or running.
5. **Executing** — the operator is carrying out the plan.
6. **Awaiting review** — execution ended and needs outcome evaluation.
7. **Completed, rejected, abandoned, or failed** — terminal desire state.

Status alone does not prove the intended outcome occurred. Review the execution record and outcome review.

## Create a Manual Desire

Choose **New Desire**, then provide a title, description, reason, and risk. Advanced options can set:

- one-time, recurring, or long-running goal type;
- initial strength and decay rate;
- nascent or pending start state;
- tags.

Creating a desire does not execute it.

## Plan and Review

Use **Generate Plan** to ask the desire planner for ordered steps, expected outcomes, required skills, risk, and approval requirements. Plans are versioned. You can review older versions, add critique, and regenerate instead of silently overwriting the plan history.

Use the review controls to approve or reject a plan. Approval means the plan is eligible for execution; it is not proof that work has started.

## Execute and Review the Outcome

**Execute** submits the approved desire through the bounded operator path. Follow the live progress, Queue record, and terminal execution data. When execution reaches `awaiting_review`, run **Outcome Review** to record verdict, success score, lessons, and possible next-attempt guidance.

Keep these distinctions:

- a generated plan is a proposal;
- approval is authorization;
- queue admission is not completion;
- terminal execution is not necessarily a successful outcome;
- outcome review is model analysis, not external proof.

For an external or physical action, confirm the result in the target system or device.

## Long-Running Desires

Long-running desires can include milestones, linked tasks, progress, and check-in times. Their repeated work still uses the coordinator and configured triggers. Do not create a separate scheduler for a desire.

## Related Guides

- [Tasks and Projects](/user-guide#task-management)
- [Autonomous Work](/user-guide#autonomous-agents)
- [Security and Trust](/user-guide#security-trust)
- [Dashboard and Monitoring](/user-guide#dashboard-monitoring)
