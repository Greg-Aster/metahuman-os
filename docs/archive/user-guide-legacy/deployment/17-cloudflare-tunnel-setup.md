# Cloudflare Tunnel Setup Guide

This guide walks you through setting up Cloudflare Tunnel to securely expose your MetaHuman OS instance to the internet without port forwarding.

## Overview

Cloudflare Tunnel creates a secure connection from your local MetaHuman instance to Cloudflare's edge network, allowing you to:
- Access MetaHuman from anywhere via HTTPS
- Share with friends using email-based access control
- Avoid opening ports on your router
- Get automatic SSL certificates
- Protect your home IP address

## Prerequisites

- A Cloudflare account (free tier works)
- A domain registered with Cloudflare (or transferred to Cloudflare DNS)
- MetaHuman OS installed and running

## Step 1: Install cloudflared

Download and install the Cloudflare Tunnel daemon:

```bash
# Download the latest version
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

## Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens your browser to authenticate with Cloudflare. Select the domain you want to use (e.g., `dndiy.org`).

After authentication, a certificate is saved to `~/.cloudflared/cert.pem`.

## Step 3: Create a Tunnel

```bash
cloudflared tunnel create metahuman
```

This creates:
- A tunnel named "metahuman"
- A tunnel ID (e.g., `02522857-cc96-45a7-bb77-65c22ff3c90b`)
- Credentials file at `~/.cloudflared/<TUNNEL-ID>.json`

**Save your tunnel ID!** You'll need it for DNS configuration.

## Step 4: Configure the Tunnel

Create the config file at `~/.cloudflared/config.yml`:

```yaml
tunnel: metahuman
credentials-file: /home/YOUR_USERNAME/.cloudflared/YOUR-TUNNEL-ID.json

ingress:
  - hostname: mh.yourdomain.com
    service: http://localhost:4321
  - service: http_status:404
```

Replace:
- `YOUR_USERNAME` with your Linux username
- `YOUR-TUNNEL-ID` with the tunnel ID from Step 3
- `mh.yourdomain.com` with your desired subdomain

## Step 5: Create DNS Record

You need to create a CNAME record pointing your subdomain to the tunnel.

### Option A: Manual DNS (Recommended)

1. Go to https://dash.cloudflare.com
2. Select your domain
3. Go to **DNS** → **Records**
4. Click **Add record**:
   - **Type**: CNAME
   - **Name**: `mh` (or your chosen subdomain)
   - **Target**: `YOUR-TUNNEL-ID.cfargotunnel.com`
   - **Proxy status**: Proxied (orange cloud)
   - **TTL**: Auto
5. Click **Save**

### Option B: CLI (May not work for all domains)

```bash
cloudflared tunnel route dns metahuman mh.yourdomain.com
```

If you get an error about existing records, use Option A instead.

## Step 6: Test the Tunnel

Start the tunnel manually:

```bash
cloudflared tunnel run metahuman
```

You should see:
```
Connection registered connIndex=0
Connection registered connIndex=1
Connection registered connIndex=2
Connection registered connIndex=3
```

Now test access:
1. Open https://mh.yourdomain.com in your browser
2. You should see your MetaHuman login page

## Step 7: Enable Auto-Start

MetaHuman OS has built-in tunnel management. Enable auto-start:

1. Go to **Network** in the left sidebar
2. Check **Auto-start on boot**
3. The tunnel will now start automatically with `pnpm dev`

Alternatively, you can set it manually in `etc/cloudflare.json`:

```json
{
  "enabled": true,
  "tunnelName": "metahuman",
  "hostname": "mh.yourdomain.com",
  "autoStart": true
}
```

## Step 8: Set Up Access Control (Optional but Recommended)

Protect your instance with email-based authentication:

1. Go to https://one.dash.cloudflare.com
2. Navigate to **Access** → **Applications**
3. Click **Add an application**
4. Select **Self-hosted**
5. Configure:
   - **Application name**: MetaHuman OS
   - **Subdomain**: `mh`
   - **Domain**: `yourdomain.com`
6. Click **Next**
7. Create a policy:
   - **Policy name**: Allowed Users
   - **Action**: Allow
   - **Include**: Add your email addresses (one per line)
8. Click **Next** → **Add application**

Now anyone accessing your MetaHuman instance will need to verify their email first.

## Troubleshooting

### DNS Not Resolving

Check DNS propagation:
```bash
nslookup mh.yourdomain.com
```

If you get `NXDOMAIN`, verify:
- CNAME record exists in Cloudflare dashboard
- Domain is using Cloudflare nameservers
- Wait 2-5 minutes for DNS propagation

### Tunnel Not Connecting

Check tunnel status:
```bash
ps aux | grep cloudflared
```

View tunnel logs:
```bash
journalctl -u cloudflared -f
```

Common issues:
- Wrong tunnel ID in config.yml
- Incorrect credentials file path
- Port 4321 not available (check with `lsof -i:4321`)

### Connection Refused

Verify local server is running:
```bash
curl http://localhost:4321
```

If this fails:
- Restart dev server: `pnpm dev`
- Check Astro port (may be 4322 or 4323 if 4321 is busy)
- Update `config.yml` to match the correct port

### Tunnel Shows as Not Installed

The Network Settings UI checks these paths:
- `/usr/local/bin/cloudflared`
- `/usr/bin/cloudflared`

If installed elsewhere, create a symlink:
```bash
sudo ln -s /path/to/cloudflared /usr/local/bin/cloudflared
```

## Security Best Practices

1. **Enable Cloudflare Access** - Always use email authentication for public instances
2. **Use Strong Passwords** - Set secure passwords in Security Settings
3. **Review Audit Logs** - Check `logs/audit/` regularly for suspicious activity
4. **Limit Guest Permissions** - Create guest accounts with restricted access
5. **Keep Updated** - Update cloudflared regularly: `sudo apt update && sudo apt upgrade cloudflared`

## Managing the Tunnel

### Start/Stop via UI

Use the Network Settings page:
- **Start Tunnel**: Manually start the tunnel
- **Stop Tunnel**: Stop the running tunnel
- **Auto-start toggle**: Enable/disable automatic startup

### Start/Stop via CLI

```bash
# Start
cloudflared tunnel run metahuman

# Stop (find PID first)
ps aux | grep cloudflared
kill <PID>
```

### View Status

```bash
# Check if running
./bin/mh network status

# Or via API
curl http://localhost:4321/api/cloudflare/status
```

## Next Steps

- [Share with Friends](./18-sharing-with-friends.md) - Invite others to use your instance
- [Security Settings](./19-security-settings.md) - Configure users and permissions
- [Cloudflare Access Setup](../dev/CLOUDFLARE_DEPLOYMENT_GUIDE.md) - Advanced access control

## Additional Resources

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com)
- [Cloudflare DNS Management](https://dash.cloudflare.com)
