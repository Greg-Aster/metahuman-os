# Sharing MetaHuman OS with Friends

Quick guide for inviting friends to your MetaHuman OS instance.

## Before You Share

1. **Deploy with Cloudflare Tunnel** - Follow [CLOUDFLARE_TUNNEL.md](./CLOUDFLARE_TUNNEL.md)
2. **Set up Cloudflare Access** - Whitelist friend's email
3. **Create guest account** - One account per friend

## Creating a Guest Account

### Option 1: Using Script (Current)

```bash
# Edit credentials in the script
nano scripts/create-guest.ts

# Change these lines:
const username = 'alice';              # Friend's username
const password = 'secure-password-123'; # Strong password
const displayName = 'Alice Smith';      # Friend's name
const email = 'alice@example.com';      # Friend's email

# Run the script
npx tsx scripts/create-guest.ts
```

### Option 2: Via Web UI (Planned - Phase 6.5)

Future update will add guest management to Security Settings page.

## What to Share with Your Friend

Send your friend this message (customize the template):

```
Hey! I'm giving you access to my MetaHuman OS instance.

📍 URL: https://metahuman.yourdomain.com

🔐 Credentials:
Username: alice
Password: [send via secure channel]

📧 Access Code:
When you visit the URL, Cloudflare will email you a one-time code.
Use the code to verify your identity.

ℹ️ What you can do:
- Chat with my MetaHuman persona
- Browse memories and reflections
- View tasks and projects

⚠️ Guest limitations:
- Read-only access (can't modify my data)
- Emulation mode only (stable personality, no learning)
- 1-hour session timeout

Enjoy exploring!
```

## Friend's First Visit

Your friend's login flow:

1. **Visit URL**: `https://metahuman.yourdomain.com`
2. **Cloudflare Access**: Enter their email
3. **Check Email**: One-time code from Cloudflare
4. **Enter Code**: Verify identity
5. **MetaHuman Login**: Enter username + password
6. **Explore**: Chat, browse memories, etc.

## Managing Guest Access

### View All Guests

```bash
# Currently: Check users file
cat persona/users.json | jq '.users[] | select(.role == "guest")'
```

### Revoke Access

**Remove from Cloudflare Access:**
1. Cloudflare Zero Trust → Access → Applications
2. Edit "MetaHuman OS" policy
3. Remove friend's email → Save

**Delete Guest Account:**
```bash
# Via future UI: Security Settings → Guest Management → Delete
# Via CLI: Edit persona/users.json and remove user object
```

### Extend Session (if needed)

Edit `packages/core/src/sessions.ts`:
```typescript
const GUEST_SESSION_DURATION = 3600; // 1 hour (default)
// Change to: 7200 (2 hours), 14400 (4 hours), etc.
```

## Security Tips

1. **Use unique passwords** for each guest
2. **Share passwords securely** (Signal, 1Password, etc., not email/SMS)
3. **Monitor access** via Cloudflare Analytics
4. **Revoke unused accounts** periodically
5. **Keep Cloudflare 2FA enabled** on your account

## Guest Permissions Reference

| Feature | Owner | Guest | Anonymous |
|---------|-------|-------|-----------|
| Chat (any mode) | ✅ | ⚠️ Emulation only | ❌ |
| Read memories | ✅ | ✅ | ❌ |
| Write memories | ✅ | ❌ | ❌ |
| Modify persona | ✅ | ❌ | ❌ |
| Security settings | ✅ | ❌ | ❌ |
| Task management | ✅ | ✅ Read-only | ❌ |
| Session duration | 24 hours | 1 hour | 30 min |

## Troubleshooting for Friends

### "Access Denied" at Cloudflare

- Make sure they use the **exact email** you whitelisted
- Email is case-sensitive
- Check spam folder for access code

### "Invalid username or password"

- Double-check credentials (case-sensitive)
- Make sure you created their guest account
- Try resetting their password

### Session expires too quickly

- Guest sessions are 1 hour (by design)
- They need to re-login
- Consider extending session duration (see above)

### Can't access certain features

- Guests have read-only access (expected behavior)
- Show them the permissions table above

## Future Enhancements (Roadmap)

- **Web UI for guest management** - Create/delete guests from Security Settings
- **Temporary access links** - Time-limited guest access (24 hours, 1 week, etc.)
- **Guest activity logs** - See what guests are viewing
- **Per-guest permissions** - Custom access levels for different friends
- **Guest quotas** - Rate limiting per guest user

## Related Documentation

- [Cloudflare Tunnel Setup](./CLOUDFLARE_TUNNEL.md)
- [Authentication Setup](../user-guide/17-authentication-setup.md)
- [Security Policy](../dev/SECURITY_POLICY.md)

---

**Sharing is caring, but security matters!** 🔒
