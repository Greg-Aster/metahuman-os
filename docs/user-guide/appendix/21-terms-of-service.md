# MetaHuman OS Terms of Service

**Effective date:** 2026-08-31
**Version:** 1.1

## 1. Scope

MetaHuman OS is local-first, self-hosted software. The tracked repository
`LICENSE` text governs copying, modification, and distribution. The license
label in repository metadata and the current tracked `LICENSE` text disagree;
the Installation Owner must resolve that conflict before redistribution. These
terms describe operator responsibilities and the account agreement shown by the
MetaHuman OS interface.

## 2. Data and external services

Your installation stores profiles, memories, conversations, credentials, and
other runtime data on infrastructure controlled by you or your installation
operator. The MetaHuman OS project does not provide a central hosted data store
for that content.

Local-first does not mean every configured operation stays on one machine.
MetaHuman OS supports optional remote model providers, remote MetaHuman servers,
profile synchronization, tunnels, and software-download services. When you
enable one of those features, the data needed for the request is sent to the
endpoint you configured. That endpoint and its operator may process or retain
data under their own terms and privacy policy.

You are responsible for reviewing the active configuration, choosing providers,
protecting credentials, and deciding what information may be sent outside your
installation. An air-gapped or local-only deployment requires local providers
and disabled remote integrations.

## 3. Security and availability

No software can guarantee absolute confidentiality, integrity, or availability.
You are responsible for:

- controlling access to your installation and network;
- securing credentials and provider accounts;
- maintaining tested backups of user-owned runtime data;
- reviewing autonomous capabilities and trust settings; and
- applying relevant security and software updates.

## 4. AI output and autonomous actions

Model output may be incomplete, incorrect, or unsafe. You are responsible for
reviewing output and configuring authorization boundaries before allowing the
system to contact external services, modify data, or control connected devices.

## 5. Lawful and ethical use

You must use MetaHuman OS in accordance with applicable laws, the rights and
consent of other people, and the
[Ethical Use Policy](/user-guide#22-ethical-use-policy).
You are responsible for the personas, data, integrations, and actions configured
for your installation.

## 6. License, warranty, and liability

The tracked
[repository license](https://github.com/Greg-Aster/metahuman-os/blob/main/LICENSE)
is the legal source for its warranty and liability terms. Do not rely on a
package or README license label while it conflicts with that file. Third-party
models, providers, services, and dependencies may have separate licenses and
terms.

## 7. Changes

These terms may be updated with the software. The effective date and version at
the top identify the text presented by the current repository version.

## 8. Contact

- [GitHub repository](https://github.com/Greg-Aster/metahuman-os)
- [User Guide](/user-guide)

By creating an account, you acknowledge that you have read and agree to these
terms.
