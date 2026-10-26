# Install Weeklid on a phone

Use a production build on your own computer and a phone on the same trusted local
network. No hosting, tunnel, account, or extra npm dependency is needed. HTTPS is
required for service workers and PWA installation over a LAN IP. Clicking through
a certificate warning is insufficient: first install and trust your local CA.

## Prepare the computer

Use the Node.js version required by `package.json`, install the project's existing
dependencies with `npm ci`, and have the system `openssl` command on PATH. Check
with `openssl version`; `lan:cert` exits with an installation hint if it is missing.

From the repository root:

```sh
npm run lan:cert
npm run build
npm run preview:lan
```

The generator discovers the machine's current network addresses and includes them,
`localhost`, `127.0.0.1`, and `::1` in the server certificate. Scoped IPv6 link-local
addresses are excluded; use one of the printed IPv4 URLs, for example
`https://192.168.1.42:4443/`. `localhost` on a phone means the phone itself, so use
the computer's LAN IP for this method. Keep the computer awake and preview running.

`preview:lan` binds to **0.0.0.0:4443** and fails if that port is busy. Allow inbound
TCP 4443 for Node.js on your private network if your firewall asks. The phone and
computer must be able to reach each other: guest Wi-Fi/client isolation and VPNs
can prevent this. This is Vite's local production-build preview, not a public
production server. It serves `dist/`, not the certificate directory.

The ignored `.lan-https/` directory contains:

| File | Purpose |
| --- | --- |
| `ca.crt` | Public CA certificate: the **only** file to transfer to the phone |
| `ca.key` | Private CA signing key: keep on this computer |
| `server.crt` | Server certificate, valid for 365 days |
| `server.key` | Private server key: keep on this computer |

The root is labelled **Next168 local development CA** (its name predates the rename to Weeklid and stays, so
phones that already trust it keep working), valid for 3650 days. It is
not name-constrained: trusting it permits certificates signed by its private key
for other sites too. Trust it only on your own test devices, keep both keys
private, and **remove the CA and delete these files after testing**. They are never
needed in Git. The script creates its directory and files with owner-only Unix
permissions; Windows users should also keep the directory private to their user.

Rerunning `npm run lan:cert` reuses the CA and renews the server certificate for
current IPs. Stop preview before rerunning, then restart it. A Wi-Fi/IP change
requires this renewal, not another CA installation. If the CA is incomplete,
mismatched, or has less than a year left, remove phone trust and delete the local
directory before regenerating and trusting the replacement.

`npm run preview` still serves HTTP on its normal port, 4173. HTTPS is opt-in via
`NEXT168_HTTPS_CERT` and `NEXT168_HTTPS_KEY`; `preview:lan` sets the default paths
above. To use custom files, set both variables in your shell before running
`preview:lan`. These are Node process environment variables, not `VITE_*` client
variables or `.env` settings. Missing files stop preview with a clear error and
the `npm run lan:cert` recovery command. Development and build do not read them.

## Android: trust the CA and install in Chrome

1. Copy **only** `.lan-https/ca.crt` to the phone, for example to Downloads using
   USB file transfer. With Android platform tools already installed, an alternative
   is `adb push .lan-https/ca.crt /sdcard/Download/next168-ca.crt`.
2. In Settings, open **Security & privacy → More security settings → Encryption &
   credentials → Install a certificate → CA certificate**. Names vary by vendor;
   search Settings for “CA certificate”. Confirm the warning, unlock the phone,
   and select the transferred file. Install it as a **CA**, not as a Wi-Fi or VPN
   client certificate. Google documents the [certificate settings and removal
   controls](https://support.google.com/pixelphone/answer/2844832?hl=en).
3. Reopen Chrome and enter the printed `https://<LAN-IP>:4443/` URL. There must be
   no certificate warning. If there is, check CA trust, the phone's clock, and
   whether the IP changed; do not bypass it. Managed devices may forbid user CAs.
4. Let Weeklid finish loading, then use Chrome's menu → **Add to Home screen →
   Install** (or **Install app**, depending on Chrome). Open its new icon. If only
   a shortcut is offered, check the HTTPS trust and let the page finish loading,
   then reload and retry.

## iPhone: trust the CA and install in Safari

1. Transfer **only** `.lan-https/ca.crt`, for example with AirDrop from a Mac, and
   open/accept it on the iPhone to download the certificate profile.
2. In Settings, choose **Profile Downloaded**, or **General → VPN & Device
   Management**, select **Next168 local development CA**, and install it using
   the device passcode.
3. Go to **Settings → General → About → Certificate Trust Settings**. Enable full
   trust for **Next168 local development CA** and confirm. Installing the profile
   alone does not enable SSL trust; see [Apple's manual trust
   instructions](https://support.apple.com/en-us/102390).
4. In **Safari**, open `https://<LAN-IP>:4443/` and confirm there is no certificate
   warning. Wait for the page to finish loading.
5. Choose **Share → Add to Home Screen → Add**. Depending on Safari's layout,
   Share is inside the page menu; enable **Open as Web App** if shown. Launch
   Weeklid using its Home Screen icon. See [Apple's web app installation
   guide](https://support.apple.com/en-gb/guide/iphone/iphea86e5236/ios).

## Check offline operation on either phone

1. While connected, open the installed app and wait for it to finish loading.
   Reload/reopen it once online so the service worker can control it.
2. Create a recognizable test task or time block inside the installed app.
3. Turn on airplane mode and explicitly turn Wi-Fi off. Close and reopen the
   installed app. It should load and show your saved item; navigate between Today,
   Week, and Tasks. A browser network error or a missing item means this check
   failed: reconnect, finish loading, and repeat.
4. Restore connectivity after testing. Offline planning uses local device storage;
   external assistant/network features still need connectivity. Do not clear site
   data or uninstall until you have exported anything you want to keep.

The origin includes scheme, IP, and port. A different IP or switching between USB
HTTP and LAN HTTPS creates a different storage/install origin; it does not migrate
your existing planner data. Export/import if needed. Keep using the same LAN IP
(a router DHCP reservation can help) for repeat tests.

## Android USB alternative: no certificate

With Android platform tools (`adb`) available, enable Developer options and USB
debugging, connect a data cable, and accept the computer's debugging prompt.
Confirm `adb devices` lists the phone as `device`. Build and start ordinary HTTP
preview, explicitly on port 4173 (not the HTTPS command):

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

In another terminal:

```sh
adb reverse tcp:4173 tcp:4173
```

On the phone, open **http://localhost:4173** in Chrome, install using the menu,
and run the offline check above. Chrome treats loopback HTTP as a secure context;
ADB routes the phone's port to the computer. No CA is needed. The same HTTP URL
using the computer's LAN IP is not a secure context. Keep USB connected for the
first load; unplugging it after caching is an additional offline check. If several
devices are attached, select the phone with `adb -s <serial> reverse ...`.

After use, run `adb reverse --remove tcp:4173`, stop preview, disable USB debugging,
and revoke debugging authorizations if no longer needed.

## Remove trust and clean up

Export data you want to keep first. Removing local files does **not** remove trust
from a phone.

- **Android:** Settings → Security & privacy → More security settings → Encryption
  & credentials → Trusted credentials → User. Select **Next168 local development
  CA** and remove it. Delete the copied `.crt` from Downloads too.
- **iPhone:** Settings → General → VPN & Device Management → **Next168 local
  development CA → Remove Profile**. Confirm it no longer appears under General →
  About → Certificate Trust Settings. Delete the transferred certificate file too.
- Stop preview with Ctrl+C. Delete this repository's **`.lan-https/` directory**
  (including both private keys) using your file manager, or `rm -rf .lan-https/`
  from this repository root on macOS/Linux. Remove the installed test app if no
  longer needed; it will not be able to reconnect over HTTPS after trust removal.

Never upload either key or add `.lan-https/` to Git, even temporarily.
