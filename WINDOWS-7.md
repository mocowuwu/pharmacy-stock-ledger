# Running on Windows 7

This guide explains how to run **Pharmacy Stock Ledger** on a machine running
**Windows 7**, either as a **standalone all-in-one computer** (server + till on
the same machine) or as a **till (kasir) terminal**.

---

## 1. Why the native installer cannot run on stock Windows 7

If you double-click `install-windows.bat` on Windows 7, it will stop. This is
deliberate, not a bug:

1. **Node.js 20+ requirement**: Next.js 16 requires Node.js >= 20. Node.js
   officially dropped Windows 7 in Node 18. Modern Node binaries rely on Windows
   APIs (`GetOverlappedResultEx`, `CreateFile2`, modern BCrypt) that do not exist
   in Windows 7's `kernel32.dll`. Attempting to start Node 20+ on Windows 7
   crashes immediately.
2. **PostgreSQL 18 binaries**: The PostgreSQL binaries bundled by the installer
   are compiled with modern MSVC targeting Windows 10+. `initdb` and `postgres`
   will not start on Windows 7.
3. **Missing system tools**: Windows 7 lacks `tar.exe` (which Windows introduced
   in Windows 10 build 17063) and ships with PowerShell 2.0 (which lacks
   `Invoke-WebRequest` and `Expand-Archive`).
4. **Data safety for a pharmacy**: This system manages prescription medicines,
   narcotics (`narkotika`), expired batches, and an append-only financial ledger.
   Attempting to bypass OS limits with unofficial kernel shims (such as VxKex)
   risks database `fsync` inconsistencies, silent corruption, and lock failures
   during sudden clinic power cuts.

---

## 2. The Recommended Solution: Headless Linux VM in VirtualBox

If you **must keep Windows 7 installed** (to keep existing clinic software,
printer drivers, or licenses intact), the reliable and battle-tested setup is:

- Run a lightweight **Linux virtual machine** (Debian 12 or Ubuntu 24.04 Server)
  inside **VirtualBox 6.1** on Windows 7.
- The VM runs quietly in the background without a graphical interface (using
  under 1 GB of RAM).
- The pharmacy application and PostgreSQL run natively and rock-solid inside the
  VM using the project's official `install-linux.sh`.
- The Windows 7 desktop acts as the till: opening `http://localhost:3000` in a
  browser.
- Other tills, tablets, or phones on the clinic network can connect directly to
  the pharmacy.

```
┌──────────────────────────────────────────────────────────┐
│                   Windows 7 Machine                      │
│                                                          │
│  [ Till Screen / Kasir ]                                 │
│  Browser opened to http://localhost:3000                 │
│  USB Barcode Scanner + Receipt Printer                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  VirtualBox 6.1 (Headless Background VM)           │  │
│  │  Debian 12 / Ubuntu Server (1 GB RAM)              │  │
│  │                                                    │  │
│  │  - PostgreSQL 18 (Real POSIX fsync, ACID safe)     │  │
│  │  - Node 22 + Next.js 16 Application                │  │
│  │  - Port 3000 forwarded to Windows 7 & Clinic LAN   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Step-by-Step Setup

### Step 1: Install VirtualBox 6.1 on Windows 7

VirtualBox 6.1.50 is the final version certified for Windows 7 hosts:

1. Download **VirtualBox 6.1.50 for Windows hosts**:
   `https://download.virtualbox.org/virtualbox/6.1.50/VirtualBox-6.1.50-161033-Win.exe`
2. Run the installer and complete the setup with default options.

> [!NOTE]
> Ensure **Hardware Virtualization (Intel VT-x or AMD-V)** is enabled in your
> computer's BIOS/UEFI settings.

### Step 2: Download a Minimal Linux ISO

Download a lightweight, headless Linux installer:
- **Debian 12 "Netinst" (Recommended, 600 MB)**:
  `https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/`
- Or **Ubuntu Server 24.04 LTS**:
  `https://ubuntu.com/download/server`

### Step 3: Create the Virtual Machine

In VirtualBox:
1. Click **New**:
   - Name: `pharmacy-server`
   - Type: `Linux`
   - Version: `Debian (64-bit)` or `Ubuntu (64-bit)`
2. **Memory (RAM)**: Allocate `1536 MB` to `2048 MB` (leave at least 1.5 GB for Windows 7).
3. **Hard Disk**: Create a virtual hard disk, **VDI**, dynamically allocated, `15 GB`.
4. Open the VM **Settings**:
   - Under **System > Processor**: Allocate 1 or 2 CPU cores.
   - Under **Storage**: Select the empty optical drive and choose your downloaded Linux ISO.
   - Under **Network**:
     - *Mode A (Bridged - Best for multi-till clinics)*: Set Attached to: **Bridged Adapter**
       and select your network card. The VM will receive its own IP address on your
       clinic router (e.g. `192.168.1.50`), directly reachable from other tills.
     - *Mode B (NAT with Port Forwarding - Best for standalone single PC)*: Set Attached to:
       **NAT**. Click **Advanced > Port Forwarding**, and add a rule:
       `Host Port: 3000` | `Guest Port: 3000`.

### Step 4: Install Linux and Run the Pharmacy Installer

1. Start the VM and follow the standard text installation.
   - Do not install a desktop environment (uncheck GNOME/XFCE); install only standard
     system utilities and OpenSSH server.
2. Once installed, reboot into Linux, log in, and run:
   ```bash
   sudo apt update && sudo apt install -y git curl
   git clone https://github.com/mocowuwu/pharmacy-stock-ledger.git
   cd pharmacy-stock-ledger
   sh install-linux.sh
   ```
3. The installer fetches its own PostgreSQL, builds the application, seeds the
   initial owner account, and starts the background service.
4. **Write down the owner password and the LAN address** printed in the box at
   the end.

### Step 5: Auto-Start the Pharmacy on Windows 7 Boot

To ensure the pharmacy comes back automatically after a power cut without
anyone logging into VirtualBox manually:

1. Create a script at `C:\pharmacy-vm\start-pharmacy.bat`:
   ```cmd
   @echo off
   "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" startvm "pharmacy-server" --type headless
   ```
2. Open Windows 7 **Task Scheduler** (`taskschd.msc`):
   - Click **Create Task**.
   - Name: `PharmacyBackgroundServer`.
   - Security options: Select **Run whether user is logged on or not**, check **Run with highest privileges**.
   - Triggers: New -> **At startup**.
   - Actions: New -> Start a program -> `C:\pharmacy-vm\start-pharmacy.bat`.
3. The pharmacy server will now start automatically whenever the Windows 7 PC powers on.

---

## 4. Using Windows 7 as the Till / Kasir

On the Windows 7 host machine:

### 1. Recommended Browser
Windows 7's default Internet Explorer or outdated Chrome 109 may lack modern
browser security and features. We recommend:
- **Supermium** (`https://win32subsystem.live/supermium/`): An up-to-date Chromium
  fork specifically maintained for Windows 7.
- Or **Firefox ESR 115**: The final Firefox extended support release supporting Windows 7.

### 2. Create an App-Like Desktop Shortcut
You can launch the till without browser toolbars or URL bars:
1. Right-click the Windows 7 Desktop -> **New > Shortcut**.
2. If using Supermium:
   ```cmd
   "C:\Program Files\Supermium\chrome.exe" --app=http://localhost:3000
   ```
   *(If you used Bridged networking, replace `localhost` with the VM's LAN IP).*
3. Name it **Apotek - Kasir**.
4. Double-clicking this icon opens the till full-screen like a dedicated POS app.

### 3. Hardware Support
- **Barcode Scanners**: USB barcode scanners act as standard HID keyboards in
  Windows 7. Scanning a barcode automatically fills the medicine search box.
- **Receipt Printers**: Standard 58mm / 80mm ESC/POS thermal printers installed
  in Windows 7 work normally when printing sales receipts from the browser.

---

## 5. Other Machines on the Clinic Network

Any other computer, tablet, or phone connected to the clinic Wi-Fi or LAN can
access the pharmacy immediately by opening the server's IP address:
```
http://<server-ip>:3000
```
Refer to [DEPLOY.md](file:///Users/mozell/Documents/Claude/Farmacy%20Project/DEPLOY.md)
for instructions on taking backups, managing accounts, and day-to-day operations.
