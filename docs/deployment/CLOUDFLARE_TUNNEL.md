# Cloudflare Tunnel Deployment Guide

Deploy MetaHuman OS securely to the internet using Cloudflare Tunnel, allowing you to share your MetaHuman with select friends while keeping your home server protected.

## Overview

**Cloudflare Tunnel** creates a secure, encrypted connection from your local MetaHuman server to Cloudflare's edge network without opening ports on your router. Combined with **Cloudflare Access**, you can control exactly who can access your MetaHuman.

### Benefits

- No port forwarding or firewall configuration needed
- Automatic HTTPS with Cloudflare SSL certificates
- DDoS protection included
- Email-based access control (whitelist specific friends)
- Free tier supports most use cases
- Works from anywhere (home, mobile, work networks)

### Architecture

```
Your Server (MetaHuman)
    ↓ (encrypted tunnel)
Cloudflare Edge Network
    ↓ (HTTPS)
Your Friends' Browsers
```

## Prerequisites

1. **Cloudflare Account** (free tier works)
2. **Domain name** managed by Cloudflare DNS
   - If you don't have one: Buy from Cloudflare Registrar or transfer existing domain
3. **MetaHuman OS** running locally
4. **Linux server** (where MetaHuman runs)

## Part 1: Install Cloudflare Tunnel

### Step 1: Install `cloudflared`

```bash
# Download latest cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

### Step 2: Authenticate with Cloudflare

```bash
# This opens a browser window to login
cloudflared tunnel login
```

Follow the browser prompt:
1. Select your domain
2. Authorize cloudflared
3. Certificate saved to `~/.cloudflared/cert.pem`

### Step 3: Create a Tunnel

```bash
# Create tunnel named "metahuman"
cloudflared tunnel create metahuman

# Note the Tunnel ID from output (e.g., 12345678-1234-1234-1234-123456789abc)
```

### Step 4: Configure DNS

Point a subdomain to your tunnel:

```bash
# Replace <TUNNEL_ID> with your actual tunnel ID
# Replace yourdomain.com with your actual domain
cloudflared tunnel route dns metahuman metahuman.yourdomain.com
```

This creates a DNS CNAME record: `metahuman.yourdomain.com` → `<TUNNEL_ID>.cfargotunnel.com`

### Step 5: Create Configuration File

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: metahuman
credentials-file: /home/YOUR_USERNAME/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: metahuman.yourdomain.com
    service: http://localhost:4321
  - service: http_status:404
```

Replace:
- `YOUR_USERNAME` with your Linux username
- `<TUNNEL_ID>` with your tunnel ID from Step 3
- `metahuman.yourdomain.com` with your chosen subdomain

### Step 6: Test the Tunnel

```bash
# Start MetaHuman dev server
cd /home/greggles/metahuman
pnpm dev

# In another terminal, start the tunnel
cloudflared tunnel run metahuman
```

Visit `https://metahuman.yourdomain.com` in your browser. You should see MetaHuman!

## Part 2: Set Up Access Control

Now let's restrict access to only approved friends using Cloudflare Access.

### Step 1: Navigate to Cloudflare Zero Trust

1. Go to [https://one.dash.cloudflare.com/](https://one.dash.cloudflare.com/)
2. Select your account
3. Go to **Access** → **Applications**

### Step 2: Create an Access Application

Click **Add an application** → **Self-hosted**

**Application Configuration:**
- **Name:** MetaHuman OS
- **Session Duration:** 24 hours (or your preference)
- **Application domain:**
  - Subdomain: `metahuman`
  - Domain: `yourdomain.com`
  - Path: (leave empty to protect entire site)

Click **Next**

### Step 3: Create Access Policy

**Policy Name:** Approved Friends

**Action:** Allow

**Configure rules:**
1. **Selector:** Emails
2. **Value:** Enter your friends' email addresses (one per line):
   ```
   alice@example.com
   bob@gmail.com
   charlie@yahoo.com
   ```

Click **Next** → **Add application**

### Step 4: Test Access Control

1. Visit `https://metahuman.yourdomain.com` (logged out)
2. You should see Cloudflare Access login page
3. Enter one of the approved emails
4. Check email for one-time code
5. Enter code → Access granted!

Unapproved emails will see "Access Denied"

## Part 3: Run as System Service

Make the tunnel start automatically on boot.

### Create systemd Service

```bash
# Install as a service
sudo cloudflared service install
```

This creates `/etc/systemd/system/cloudflared.service`

### Start and Enable Service

```bash
# Start the service
sudo systemctl start cloudflared

# Enable on boot
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared
```

### View Logs

```bash
# Follow tunnel logs
sudo journalctl -u cloudflared -f
```

## Part 4: Configure MetaHuman for Production

### Set Production Environment Variables

Create `.env.production` in MetaHuman root:

```bash
# Public URL
PUBLIC_URL=https://metahuman.yourdomain.com

# Security
NODE_ENV=production

# Optional: High security mode (emulation only for guests)
HIGH_SECURITY=false
```

### Update Session Security

Sessions should use secure cookies over HTTPS. Edit `packages/core/src/sessions.ts`:

```typescript
// In createSession function, update cookie options:
const secureCookie = process.env.NODE_ENV === 'production';

context.cookies.set('mh_session', session.id, {
  httpOnly: true,
  secure: secureCookie,  // true in production
  sameSite: 'strict',
  maxAge: duration * 1000,
  path: '/',
});
```

## Guest User Management

### Create Guest Accounts for Friends

Option 1: Using CLI (current):

```bash
# Create a script similar to create-owner.ts
npx tsx scripts/create-guest.ts
```

Option 2: Using Security Settings UI (recommended - see next section)

### Guest Access Permissions

Guests have limited permissions:
- Read-only access to memories
- Cannot modify persona or settings
- Cannot access security settings
- Emulation mode only (if HIGH_SECURITY=true)
- 1-hour session duration (vs 24h for owner)

## Security Best Practices

### 1. Use Strong Passwords

All users (owner and guests) should use strong passwords:
- Minimum 12 characters
- Mix of uppercase, lowercase, numbers, symbols
- Use password manager

### 2. Regular Updates

```bash
# Update cloudflared monthly
sudo apt update
sudo apt install cloudflared

# Restart service
sudo systemctl restart cloudflared
```

### 3. Monitor Access

View who's accessing your MetaHuman:
- Cloudflare Dashboard → Analytics → Access Requests
- MetaHuman audit logs: `logs/audit/`

### 4. Revoke Access

Remove a friend's access:
1. Cloudflare Zero Trust → Access → Applications
2. Edit "MetaHuman OS" application
3. Edit policy → Remove their email
4. Delete their guest account in MetaHuman Security Settings

### 5. Enable 2FA for Cloudflare

Protect your Cloudflare account with two-factor authentication:
- Cloudflare Dashboard → My Profile → Authentication
- Enable Two-Factor Authentication

## Troubleshooting

### Tunnel won't start

```bash
# Check tunnel status
cloudflared tunnel info metahuman

# Check configuration syntax
cloudflared tunnel ingress validate

# View detailed logs
cloudflared tunnel run metahuman --loglevel debug
```

### DNS not resolving

```bash
# Check DNS record
dig metahuman.yourdomain.com

# Should return CNAME to .cfargotunnel.com
```

### Access policy not working

1. Check email is exactly as entered (case-sensitive)
2. Verify policy is set to "Allow" not "Block"
3. Check Cloudflare Zero Trust → Logs for denied attempts

### MetaHuman connection issues

```bash
# Ensure dev server is running on port 4321
lsof -i :4321

# Check tunnel is forwarding to correct port
cat ~/.cloudflared/config.yml
```

### Sessions not persisting

Make sure `secure: true` only in production:
```typescript
secure: process.env.NODE_ENV === 'production'
```

## Mobile Access

Your friends can access MetaHuman from mobile devices:

1. Visit `https://metahuman.yourdomain.com` on phone
2. Enter approved email
3. Check email on phone for code
4. Access granted

**Tip:** Add to home screen for app-like experience:
- iOS: Safari → Share → Add to Home Screen
- Android: Chrome → Menu → Add to Home Screen

## Costs

**Free Tier Includes:**
- Unlimited bandwidth
- Unlimited requests
- Up to 50 users in Cloudflare Access
- Standard DDoS protection

**Paid Features (optional):**
- More than 50 users: $3/user/month
- Advanced security rules
- Audit logs retention

For personal use with friends, **free tier is sufficient**.

## Next Steps

1. **Create guest accounts** for each friend
2. **Share the URL** with approved friends
3. **Monitor usage** via Cloudflare Analytics
4. **Set up mobile access** instructions for friends
5. **Consider Cloudflare Pages** for static frontend (advanced)

## Alternative: Cloudflare Pages (Hybrid Deployment)

For even better performance, deploy the frontend to Cloudflare Pages and keep the API on your local server:

1. Build static frontend: `pnpm build`
2. Deploy to Cloudflare Pages
3. Use separate tunnel for API endpoints
4. Update frontend to call API via tunnel URL

See `docs/deployment/CLOUDFLARE_PAGES.md` for full guide (coming soon).

## Related Documentation

- [Authentication Setup](../user-guide/17-authentication-setup.md)
- [Security Settings](../user-guide/XX-security-settings.md)
- [Guest User Management](../user-guide/XX-guest-users.md)
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Cloudflare Access Docs](https://developers.cloudflare.com/cloudflare-one/policies/access/)

---

**You're now ready to share MetaHuman OS with friends securely!**
