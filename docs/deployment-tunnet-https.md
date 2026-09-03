# Deploying over a Tunnet mesh with real HTTPS

How to reach Wherever from your phone (or any device) at a URL like `https://wherever.nono.ska.sh`, with a certificate browsers actually trust, without exposing anything to the public internet.

This replaces the built-in self-signed certificates. Those are fine for `https://localhost:31415`, but on a phone they produce a warning you have to click through, and a clicked-through warning is not a proper secure context: installing the PWA and registering its service worker either misbehaves or is refused outright. A real certificate fixes that, and this setup gets one for a machine that has no public IP at all.

## How it fits together

[Tunnet](https://tunnet.io) gives every machine a private mesh address in `100.64.0.0/10` and lets your devices reach each other directly, wherever they are. You publish a public DNS name pointing at that private address, and obtain a real Let's Encrypt certificate for the name.

The certificate is the interesting part. Let's Encrypt cannot use the usual HTTP-01 challenge here, because that requires reaching your machine from the public internet, and a mesh address is not routable. The **DNS-01** challenge proves control of the domain by writing a TXT record instead, so no inbound connection is ever needed. This is the same mechanism Tailscale uses to issue certificates for `*.ts.net` names.

The result: a public DNS name resolves to a private mesh address, the certificate is publicly trusted, and the service is reachable only by devices on your mesh.

```
phone (on the mesh)
  |  https://wherever.nono.ska.sh
  |  DNS -> 100.95.248.22 (public record, private address)
  v
Tunnet mesh
  v
nono, at 100.95.248.22
  |  TLS terminated by Caddy (option 2) or by Wherever itself (option 1)
  v
Wherever
```

## Mesh addresses are stable

Worth knowing before you put one in DNS: a Tunnet address is derived by hashing the node's own public key into `100.64.0.0/10`, not leased from a server. Nothing hands it out, so nothing can hand out a different one later.

In practice that means the address survives reboots, agent restarts, and the coordinator being offline or reinstalled. It changes only if the node loses its identity: `tunnet reset` on a desktop, or uninstalling / clearing storage for the Android app. Keep the state directory and the DNS record stays valid.

## Two ways to do it

**Option 1, certificate only.** Get a certificate with any ACME client that supports DNS-01, drop it where Wherever already looks, and let the server terminate TLS itself. Closest to the Tailscale instructions in the README, and enough if you only publish Wherever. You keep the port in the URL: `https://nono.ska.sh:31415`.

**Option 2, Caddy in front.** Caddy obtains and renews certificates itself and reverse-proxies to Wherever. Worth it when you want a name per service (`https://wherever.nono.ska.sh`), several services on one machine, or renewal that never needs a restart.

Both need the same DNS setup, so start with steps 1 to 3 either way.

## Prerequisites

- Tunnet installed on the machine, joined to your network, and running.
- A domain whose DNS is hosted somewhere with an API (this guide uses Cloudflare).
- For option 2, Caddy **built with the Cloudflare DNS module**. The stock binary cannot do DNS-01 with Cloudflare. Either download a build with `caddy-dns/cloudflare` selected from the Caddy download page, or build one with `xcaddy build --with github.com/caddy-dns/cloudflare`.

## 1. Find the machine's mesh address

```bash
tunnet status
```

Note the mesh IP (`100.95.248.22` in the examples below).

## 2. Create the DNS records

Point the names at the mesh address. Both records must be **DNS only**, the grey cloud in Cloudflare:

```
A  nono.ska.sh     100.95.248.22   DNS only
A  *.nono.ska.sh   100.95.248.22   DNS only
```

Proxying (the orange cloud) sends visitors to Cloudflare's edge, which cannot reach a private mesh address, so a proxied record simply will not work. Wildcard records are fine on the free plan as long as they are not proxied.

The wildcard is only needed for option 2, where it is what lets you add services later without touching DNS or certificates again. Option 1 needs just the first record.

## 3. Create a scoped API token

Whichever ACME client you use needs permission to write the DNS-01 TXT record. In the Cloudflare dashboard create an API token with **Zone → DNS → Edit**, restricted to that one zone. Nothing broader is required.

For option 1 you can keep it in your shell environment when running the client. For option 2, put it somewhere only root can read rather than inline in the Caddyfile:

```bash
sudo install -m 600 /dev/null /etc/caddy/caddy.env
sudo tee /etc/caddy/caddy.env >/dev/null <<'EOF'
CLOUDFLARE_API_TOKEN=your-token-here
EOF
```

## Option 1: certificate only, no proxy

Issue a certificate with a DNS-01 capable ACME client. With [lego](https://go-acme.github.io/lego/):

```bash
CLOUDFLARE_DNS_API_TOKEN=your-token-here \
lego --email you@example.com --dns cloudflare \
     --domains nono.ska.sh --path ~/.lego run
```

Write it where the server already looks, so no flags are needed. Wherever only generates a self-signed pair when these files are **missing**:

```bash
mkdir -p ~/.wherever/certs
cp ~/.lego/certificates/nono.ska.sh.crt ~/.wherever/certs/localhost.crt
cp ~/.lego/certificates/nono.ska.sh.key ~/.wherever/certs/localhost.key

wherever start --host 0.0.0.0 --token your-secure-token
```

The filenames stay `localhost.*` while containing a certificate for your real name; the server cares about the path, not the name. Then open `https://nono.ska.sh:31415`, using the **name**, not the address, because the certificate is bound to the name.

Bind to `0.0.0.0` here rather than the mesh address, so the server keeps working on `localhost` too. If you would rather it be reachable only over the mesh, use `--host 100.95.248.22`.

**Renewal.** The server reads the certificate files once at startup, so renewing means re-running the issue command and restarting Wherever. If that bookkeeping annoys you, that is precisely what option 2 removes.

## Option 2: Caddy in front

This serves subdomains on 443 and, separately, keeps specific ports working for services that expect them.

```caddyfile
# Shared settings. `bind` is what keeps this mesh-only: without it Caddy would
# also answer on your LAN address.
(mesh) {
	bind 100.95.248.22
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
}

# One name per service, all on 443, covered by the wildcard certificate.
# Adding a service is three lines here and nothing anywhere else.
*.nono.ska.sh, nono.ska.sh {
	import mesh

	@wherever host wherever.nono.ska.sh
	handle @wherever {
		reverse_proxy 127.0.0.1:31415
	}

	handle {
		respond "no service mapped for {host}" 404
	}
}

# Services that must keep their port in the URL. Add ports to this list as
# needed; the proxy target follows the port the request arrived on, so there is
# no second thing to keep in sync.
nono.ska.sh:31415, nono.ska.sh:8545 {
	import mesh
	reverse_proxy 127.0.0.1:{http.request.local.port}
}
```

Both URL shapes now work:

- `https://wherever.nono.ska.sh`
- `https://nono.ska.sh:31415` and `https://nono.ska.sh:8545`

A note on origins: `https://nono.ska.sh:31415` and `https://wherever.nono.ska.sh` are **different origins** as far as the browser is concerned. If you already installed the PWA from the port-based URL, its local storage and installed state do not carry across to the subdomain. Pick the shape you want to live with, or keep both and accept that they are two separate installs.

## Run Wherever behind Caddy

Caddy owns TLS now, so the server should speak plain HTTP on loopback and stop generating its own certificates:

```bash
wherever install --http --host 127.0.0.1 --port 31415
```

`--host 127.0.0.1` matters: Wherever is reachable through Caddy, so it does not need to listen on any other interface.

## Start Caddy after the mesh is up

Because Caddy binds the mesh address explicitly, it cannot start before that address exists. On a systemd host, order it after the Tunnet service and let it retry:

```ini
# /etc/systemd/system/caddy.service.d/override.conf
[Unit]
After=tunnet.service
Wants=tunnet.service

[Service]
EnvironmentFile=/etc/caddy/caddy.env
Restart=on-failure
RestartSec=5s
```

Without the ordering, a reboot races the agent and Caddy fails to bind.

## Verify

From a device on the mesh:

```bash
curl -I https://wherever.nono.ska.sh     # option 2
curl -I https://nono.ska.sh:31415        # option 1
```

A `200`, and no certificate warning in a browser. On a phone, the PWA should now install and launch standalone rather than in a browser tab.

## Running it on more than one machine

Give each machine its own name rather than moving one record around. The workstation gets its own mesh address, its own DNS records, and its own Caddy with its own certificate:

```
A  nono.ska.sh            100.95.248.22       DNS only
A  *.nono.ska.sh          100.95.248.22       DNS only
A  workstation.ska.sh     100.x.x.x           DNS only
A  *.workstation.ska.sh   100.x.x.x           DNS only
```

If you want one canonical entry point, add a `CNAME wherever.ska.sh -> wherever.nono.ska.sh` and repoint it when you move. Both machines stay reachable under their own names either way, which is usually what you want when a session is running on one of them.

## Troubleshooting

**The name resolves but nothing connects.** Check the record is grey cloud, not orange. A proxied record cannot reach a mesh address.

**The name does not resolve at all on one network.** Some resolvers and routers strip answers containing private or carrier-grade NAT addresses, as rebinding protection. Compare `dig +short wherever.nono.ska.sh` on that network against another one. If it is empty on only one, that is the cause.

**Certificate issuance fails.** Confirm the token has Zone → DNS → Edit on the right zone, and that Caddy is the build with the Cloudflare module. HTTP-01 will never work here, so if the logs show it attempting an HTTP challenge, the `tls` block is not being applied.

**Renewal.** Nothing inbound is needed, only outbound access to the Cloudflare API and Let's Encrypt, so renewal keeps working on a machine that is only reachable over the mesh.

**Tailscale on the same machine.** Tailscale also uses `100.64.0.0/10`. Running both means the range is contested: Tailscale drops mesh packets arriving on the Tunnet interface, and Tunnet's route can swallow Tailscale-bound traffic. If the name resolves and the mesh is healthy but connections still fail, check whether both are up.

**The address changed.** The node lost its identity (a `tunnet reset`, or an app uninstall). Get the new address from `tunnet status` and update the record.
