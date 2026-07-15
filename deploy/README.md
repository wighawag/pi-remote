# Deploying wherever on a cloud box (Debian 13 + Caddy)

This directory contains tooling to stand up a `wherever-dev` server on a fresh Debian 13 ("trixie") cloud instance (tested on Hetzner Cloud) using [cloud-init](https://cloudinit.readthedocs.io/). Node is managed with [fnm](https://github.com/Schniz/fnm), and the server can be served publicly behind [Caddy](https://caddyserver.com/) with an automatic Let's Encrypt certificate so you reach it at `https://<your-subdomain>` with no port and no certificate warning (and it installs as a PWA).

## Files

- `generate-cloud-init.sh` - interactive/CLI generator that produces a ready-to-paste cloud-init YAML with your values filled in. Output defaults to `deploy/out/` (git-ignored) because it contains secrets.
- `hetzner-cloud-init.yaml` - a static template with placeholders (no secrets), kept for reference. Prefer the generator.
- `out/` - git-ignored; generated YAML and any in-place helper scripts land here.

## What the generated server looks like

- A non-root sudo user (key-only login) that owns and runs everything.
- fnm + a pinned Node LTS, `wherever-dev` installed globally, running as a **systemd** service.
- `git` + the GitHub CLI (`gh`), authenticated from a token you provide.
- Optionally: a git SSH private key, a `~/.wherever/config.json`, and a pi `~/.pi/models.json`.
- Optionally (with `--domain`): Caddy fronting wherever on 443 with a real cert; wherever itself runs plain HTTP bound to `127.0.0.1` only, and the wherever port is **not** exposed publicly.

## Quick start

Generate the cloud-init:

```bash
./generate-cloud-init.sh \
  --username svcuser \
  --ssh-key-file ~/.ssh/id_ed25519.pub \
  --git-name "Service Account" \
  --git-email you@example.com \
  --domain wherever.example.com \
  --gh-token "$(cat /path/to/box-github-pat)" \
  --git-ssh-key-file ~/.ssh/box_git_ed25519 \
  --models-file ~/.pi/models.json
```

Anything omitted is prompted interactively (secrets are read hidden); pass `-y` to never prompt and rely on flags/env/defaults. Run `./generate-cloud-init.sh --help` for the full option list.

Then create the server with the generated file as user-data, e.g. on Hetzner:

```bash
hcloud server create --name wherever --type cx22 --image debian-13 \
  --ssh-key <your-ssh-key-name> \
  --user-data-from-file out/wherever-cloud-init.yaml
```

## DNS for the domain (do this before/at create time)

Caddy obtains the certificate via an ACME challenge, so the domain must resolve to the box's public IP.

1. Add an **A record**: `wherever.example.com -> <box public IP>`.
2. If you use Cloudflare, set it to **DNS only (grey cloud)**, not proxied. A proxied (orange cloud) record intercepts the ACME challenge and terminates TLS with Cloudflare's own certificate, which breaks Caddy's default issuance and can interfere with WebSockets. Grey cloud lets Caddy issue and serve the real certificate directly. (Proxying can be added later with the DNS-01 challenge and a scoped API token, but that is out of scope here.)
3. Make sure there is exactly **one** A record and it points at the real public IP. A stray extra A record (for example an unroutable `100.64.0.0/10` address) will make issuance flaky, because Let's Encrypt validates against every A record.
4. Confirm the authoritative answer is correct (your local resolver may cache an old value for a short while):

   ```bash
   dig +short wherever.example.com @1.1.1.1
   ```

## pi models, default model, and extensions

The pi agent that wherever runs reads two files in the run user's home:

- `~/.pi/models.json` - provider/model definitions **with API keys** (secret). Ship yours with `--models-file`.
- `~/.pi/agent/settings.json` - the **default model/provider** (`defaultModel`, `defaultProvider`, `defaultThinkingLevel`, `enabledModels`) and the **extensions** list (`packages`). Ship yours with `--settings-file`.

The generator always ensures `npm:@wherever-dev/pi` (the wherever bridge extension) is present in `packages`. Add more extensions without editing the file using `--pi-package` (repeatable), e.g. `--pi-package npm:pi-webveil`. pi installs everything in `packages` on first run, so there is no separate extension-install step.

## Web search via pi-webveil + SearXNG (`--with-searxng`)

`--with-searxng` installs [SearXNG](https://github.com/searxng/searxng) bare (no Docker) from the upstream sources into `/usr/local/searxng`, served by **uWSGI** over a unix socket at `/usr/local/searxng/run/socket`. The socket uses `http-socket` so it speaks HTTP, which is what pi-webveil's `unix:` base URL expects. A fresh `secret_key` is generated per install and the rate limiter is disabled.

It also writes `~/.config/webveil/config.json` for the run user:

```json
{
  "backend": "searxng",
  "baseUrl": "unix:/usr/local/searxng/run/socket",
  "egress": { "mode": "direct" },
  "fetchEgress": { "mode": "direct" }
}
```

Both egress paths are `direct` (no Tor/SOCKS): on a server the anonymity proxy layer that webveil supports is not set up, so requests go out directly. `--with-searxng` implies adding `npm:pi-webveil` to `packages`.

To verify after boot:

```bash
systemctl status uwsgi --no-pager
ls -l /usr/local/searxng/run/socket          # a socket (srw-...) should exist
curl --unix-socket /usr/local/searxng/run/socket http://localhost/healthz
```

## Secrets and credential hygiene

The generated YAML contains secrets: the wherever auth token, the GitHub token, and (if provided) the git SSH private key and `models.json` API keys. Treat it accordingly:

- It is written mode `0600` under `out/`, which is git-ignored. Do not commit it.
- **Use credentials dedicated to the box**, separate from your personal machine, so a compromise of the box can be contained by revoking just those:
  - a GitHub token created specifically for the box (revoke it alone if needed);
  - a git SSH keypair created specifically for the box (`ssh-keygen -t ed25519 -C "wherever-box" -f ~/.ssh/box_git_ed25519`), whose public half you add to your account and whose private half you pass via `--git-ssh-key-file`.

## Verifying after boot

cloud-init runs on first boot (a couple of minutes). To check:

```bash
# On the box:
cloud-init status --long                 # want: status: done
systemctl status wherever --no-pager     # want: active (running)
systemctl status caddy --no-pager        # if using --domain
journalctl -u caddy -n 30 --no-pager | grep -i 'certificate obtained'
```

Then open `https://wherever.example.com`, enter your wherever token, and confirm the dashboard connects (the WebSocket upgrades over the same 443).

## Adding more services behind the same Caddy

Caddy is set up as a shared reverse proxy: the main `/etc/caddy/Caddyfile` imports every file in `/etc/caddy/sites/*.caddy`, one file per service. To add another service on its own subdomain with no port in the URL:

```bash
# On the box, as root:
cat > /etc/caddy/sites/grafana.caddy <<'EOF'
grafana.example.com {
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

Add the matching `grafana.example.com -> <box IP>` DNS A record and Caddy will obtain its certificate automatically. Bind each service to `127.0.0.1:<port>` (loopback only) and let Caddy be the sole public entry point on 80/443.

## Bridging a terminal `pi` on the box (`wherever-pi`)

If you install the `pi` CLI (`--with-pi`), the bootstrap also drops a `wherever-pi` wrapper in `~/.local/bin` so you can bridge a terminal session into the local server without remembering flags. It reads the auth token from `wherever.env` and uses the right connection settings for the deployment: with `--domain` it connects to the public HTTPS endpoint (`--remote-host <domain> --remote-port 443`), otherwise it connects to the loopback plain-`ws` server (`--remote-insecure`). Any extra arguments are passed through to `pi`:

```bash
wherever-pi                 # bridge into the local wherever server
wherever-pi --some-pi-flag  # extra args are forwarded to pi
```

(`~/.local/bin` is added to PATH in the user's `.bashrc`, alongside fnm, so `node`/`npm`/`fnm` and `wherever-pi` are all available in interactive sessions.)

## Reaching wherever without a domain

If you omit `--domain`, wherever binds `0.0.0.0` on its port with a self-signed certificate and the port is opened in the firewall. Browsers will warn about the certificate, and because a self-signed origin is not a "secure context" you cannot install the dashboard as a PWA. A real domain behind Caddy avoids all of that and is the recommended setup for anything beyond quick local testing.
