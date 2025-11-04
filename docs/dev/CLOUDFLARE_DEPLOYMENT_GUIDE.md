# Cloudflare Tunnel Deployment Guide (MetaHuman OS)

**Date:** 2025-11-04  
**Author:** Codex (for greggles)  
**Status:** Ready for implementation  
**Scope:** Explain how to expose the Astro-based MetaHuman OS UI + APIs securely over the internet using Cloudflare Tunnel, including login flow and role-based safety defaults.

---

## 1. Overview

Goal: Keep MetaHuman OS running locally (GPU access, memories, files) but offer friends a public URL. We tunnel traffic through Cloudflare so we don't open ports or host the app elsewhere.

Key features:
- HTTPS endpoint via Cloudflare
- Login gate with session cookies
- Cognitive mode forced to "emulation" for guests
- Owner accounts can flip to dual/agent modes once signed in
- Clear setup so new installs can repeat the process

---

## 2. Prerequisites

- Cloudflare account with a domain (free tier works)
- `cloudflared` installed on the host machine
- MetaHuman OS running locally on `http://localhost:4321` (default Astro dev server)
- Node/PNPM environment ready for UI/Server tweaks

---

## 3. Tunnel Setup

### 3.1 Login & Authorize
```bash
cloudflared login
```
Choose the domain you'll use (e.g., `metahuman.yourdomain.com`).

### 3.2 Create Tunnel
```bash
cloudflared tunnel create metahuman-os
```
This generates `/home/USER/.cloudflared/metahuman-os.json`.

### 3.3 Configure Routing
Create `~/.cloudflared/config.yml`:

```yaml
tunnel: metahuman-os
credentials-file: /home/USER/.cloudflared/metahuman-os.json

ingress:
  - hostname: metahuman.yourdomain.com
    service: http://localhost:4321
  - service: http_status:404
```

### 3.4 Run as Service
```bash
cloudflared service install
cloudflared tunnel run metahuman-os
```

Your app is now externally reachable at `https://metahuman.yourdomain.com`.

---

## 4. Application Security Layers

### 4.1 Session-Based Login (Astro backend)
- Add `/apps/site/src/pages/login.astro` for the form.
- API routes:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/session` (returns current user)
- Store credentials in `etc/users.json`:
  ```json
  {
    "owner": {
      "passwordHash": "$argon2id$v=19$m=...",
      "roles": ["owner"]
    },
    "guest": {
      "passwordHash": "...",
      "roles": ["guest"]
    }
  }
  ```
- Use Argon2 or bcrypt hashed passwords.
- Set secure cookies: `Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax`.

### 4.2 Protect API Routes
Wrap relevant endpoints with session checks:

| Endpoint | Requirement | Behavior if guest |
|----------|-------------|-------------------|
| `/api/cognitive-mode` (GET) | Any session | Force response `mode=emulation` if `role !== owner` |
| `/api/cognitive-mode` (POST) | owner only | Return 403 for guests |
| `/api/operator`, `/api/approvals`, `/api/trust` | owner only | Return 403/redirect |
| `/api/status` | Any session | Return `modelRoles` plus `mode` info (guests see emulation) |

### 4.3 UI Adjustments
- Before rendering the main UI, call `/api/auth/session`.
- If not logged in → redirect to `/login`.
- Show current role in header/footer.
- Disable cognitive mode selector for guests (display "Emulation mode enforced").
- Hide operator/approval panels for guests.

### 4.4 Optional Cloudflare Access
For extra security, enable Cloudflare Access (Zero Trust):
1. Cloudflare dashboard → Access → Applications → Add.
2. Point to `metahuman.yourdomain.com`.
3. Require login via email or identity provider.
4. Our internal login is still useful once they’re through Cloudflare.

---

## 5. Default Modes & Safety

- On new sessions, backend sets `mode = 'emulation'`.
- Owner can switch to `dual` or `agent` via UI once authenticated.
- Guests never see operator panel and cannot trigger skills.
- Memory writes are blocked when `mode === 'emulation'`.
- Audit log entries must include `sessionUser`, `role`, and `cognitiveMode`.

---

## 6. Packaging for Deployment

### 6.1 Documentation & Scripts
- Update `README.md` or create `docs/setup/DEPLOYMENT.md` referencing this guide.
- Provide example `etc/users.json` template with instructions on generating password hashes.
- Add `package.json` script for hashing passwords:
  ```json
  "scripts": {
    "hash:password": "node scripts/hash-password.mjs"
  }
  ```

### 6.2 Environment Variables
- `.env`:
  - `SESSION_SECRET` (secure random string)
  - `MODEL_REGISTRY=./etc/models.json`
  - `USER_DB=./etc/users.json`

### 6.3 Install Helper
Offer a script `scripts/setup-cloudflare-tunnel.sh`:
```bash
#!/usr/bin/env bash
set -e

echo "Installing cloudflared..."
curl -fsSL https://developers.cloudflare.com/cloudflare-one/static/cloudflared-install.sh | bash

cloudflared login
cloudflared tunnel create metahuman-os

cat <<EOF > ~/.cloudflared/config.yml
tunnel: metahuman-os
credentials-file: ~/.cloudflared/metahuman-os.json

ingress:
  - hostname: metahuman.yourdomain.com
    service: http://localhost:4321
  - service: http_status:404
EOF

cloudflared service install
echo "Tunnel created. Start with: cloudflared tunnel run metahuman-os"
```

Ask the user to edit the hostname before running.

---

## 7. Testing Checklist

1. **Local:** Start MetaHuman OS, confirm login/logout works.
2. **Tunnel:** Access via public URL, verify Cloudflare certificate.
3. **Guest role:** Confirm forced emulation mode and no access to operator or approvals.
4. **Owner role:** Confirm ability to switch to dual/agent modes and use operator features.
5. **Audit logs:** Verify that role, mode, and hostname appear in audit events.
6. **Memories:** Try to create/edit memory—should fail for guest; succeed for owner when mode allows.
7. **Performance:** Ensure latency is acceptable through tunnel, especially for streaming responses.

---

## 8. Future Enhancements

- Add MFA or device-based trust for owner accounts.
- Network rate limiting (Cloudflare Workers or Access policies).
- Automatic Cloudflare Access integration (skip internal login if Access passes).
- Script to invite new users (generate hash + instructions).
- In-app onboarding wizard guiding new installs through tunnel configuration.

---

## 9. Glossary

- **Cloudflare Tunnel:** Outbound-only connection that exposes local services via Cloudflare’s network.
- **Emulation mode:** Read-only, no operator.
- **Dual mode:** Full operator capabilities; used for self-healing, memory writes.
- **Owner vs Guest role:** Defines what cognitive modes and APIs are available to the session.

---

**Maintainer Notes:**
- Keep this doc up-to-date with future security changes.
- Treat `etc/users.json` as sensitive—don’t commit actual hashes.
- Encourage users to rotate `SESSION_SECRET` periodically.
