# MetaHuman OS User Guide

This guide explains how to install, configure, use, monitor, and troubleshoot the
current MetaHuman OS application. It follows the maintained web interface and
`./bin/mh` CLI. Features that require an optional provider, external service,
remote server, or robot say so explicitly.

Start with the three Getting Started chapters. After first login, use the
task-oriented chapters for normal operation and the Configuration sections for
owner-only setup.

## Getting Started

- [Overview](getting-started/01-overview.md) explains the application, its main
  surfaces, and its operating boundaries.
- [Installation](getting-started/02-installation.md) installs, builds, starts,
  stops, and verifies a Linux server.
- [Setup and First Login](getting-started/03-setup-and-login.md) covers account
  creation, recovery codes, onboarding, guest access, initial model checks, and
  a first-use walkthrough.

## Using MetaHuman

- [Chat Interface](using-metahuman/chat-interface.md)
- [Dashboard and Monitoring](using-metahuman/dashboard-monitoring.md)
- [Memory System](using-metahuman/memory-system.md)
- [Task Management](using-metahuman/task-management.md)
- [Voice Features](using-metahuman/voice-features.md)

## Training and Personalization

- [AI Training](training-personalization/ai-training.md)
- [Cognitive Modes](training-personalization/cognitive-modes.md)
- [Persona Editor](training-personalization/persona-editor.md)
- [Persona Generator](training-personalization/persona-generator.md)
- [Voice Training](training-personalization/voice-training.md)

## Advanced Features

- [Agency System](advanced-features/agency-system.md)
- [Architecture](advanced-features/architecture.md)
- [Autonomous Work](advanced-features/autonomous-agents.md)
- [Headless Runtime Mode](advanced-features/headless-mode.md)
- [Multi-User Profiles](advanced-features/multi-user-profiles.md)
- [Node Editor](advanced-features/node-editor.md)
- [Skills System](advanced-features/skills-system.md)

## Configuration and Administration

- [Accounts and Security](configuration-admin/accounts-security.md)
- [Authentication](configuration-admin/authentication.md)
- [Configuration Ownership](configuration-admin/configuration-files.md)
- [Deployment and Remote Access](configuration-admin/deployment.md)
- [LLM Backend Configuration](configuration-admin/llm-backend.md)
- [Security and Trust](configuration-admin/security-trust.md)
- [Runtime Safety States](configuration-admin/special-states.md)

## Reference

- [CLI Command Reference](reference/cli-reference.md)
- [Frequently Asked Questions](reference/faq.md)
- [Troubleshooting](reference/troubleshooting.md)

## Policies

- [Terms of Service](appendix/21-terms-of-service.md)
- [Ethical Use Policy](appendix/22-ethical-use-policy.md)

## Reading the guide

Paths such as `System → Backend` describe web-interface navigation. Commands
are run from the repository root unless stated otherwise. Owner-only controls
are labelled; standard and guest accounts will not see every control.

Runtime status is evidence about the current installation. Documentation, source
code, or a successful build does not prove that an optional provider, remote
server, environment adapter, or physical robot is connected.

Last source reconciliation: 2026-09-01.
