# Operator Skills

Skills are bounded operations that an operator graph may invoke. Core owns their manifests, validation, trust checks, approvals, execution, and audit records. A skill is not an autonomous agent or a second work coordinator.

## Runtime Catalog

Skill availability comes from the live registered catalog. Do not rely on a static list in this guide: optional integrations and the active runtime determine what is actually registered.

Each manifest declares an identifier, category, inputs, outputs, risk, cost, minimum trust level, approval requirement, and any path or command restrictions. The operator can use only a skill that is registered and allowed in the current context.

## Execution Boundary

A skill request passes through:

1. manifest and input validation;
2. current user and trust evaluation;
3. profile and path safety checks where relevant;
4. approval admission when required;
5. the registered implementation;
6. an explicit success or failure result and audit event.

A rejected request must remain a visible rejection. Missing registration, invalid input, insufficient trust, unsafe paths, denied approval, and implementation failure are not successful execution.

## Approvals

Use **Dashboard → Approvals** for work that requires a decision. Review the requested skill, inputs, risk, and intended effect before approving. Approval authorizes that request; it does not prove execution or its external result.

Higher trust can reduce approval requirements only where policy permits. Skills marked as always requiring approval still require it.

## Paths and Data

File-oriented skills validate their permitted directories and profile context. A fuzzy path suggestion is only a suggestion; the operator or user must select the correct target. Do not approve a destructive operation based on a guessed path.

Profile data, outputs, logs, and other runtime artifacts remain outside maintained source even when a skill can access them.

## Using Skills from Chat

Ask for a concrete action in Chat and use the Active Operator or Big Brother path appropriate to the task. Then follow:

- the proposed operation or approval card;
- Queue admission;
- terminal skill result;
- the actual changed file, external system, or device when the outcome matters.

Natural-language intent alone is not evidence that a skill ran.

## Related Guides

- [Chat](/user-guide#chat-interface)
- [Agency](/user-guide#agency-system)
- [Autonomous Work](/user-guide#autonomous-agents)
- [Security and Trust](/user-guide#security-trust)
