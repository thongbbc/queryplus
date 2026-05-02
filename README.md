![QueryPlus](https://raw.githubusercontent.com/thongbbc/queryplus/master/assets/logo-mark.svg)

# QueryPlus

Cross-platform SQL client built with Tauri v2 (Rust) + React.

## Prerequisites

### Rust

- Install the Rust toolchain (rustup) for your OS.

### Linux (Ubuntu/Debian)

If you see errors like `glib-2.0.pc not found` / `glib-sys` / `gio-sys` / `webkit2gtk`, install system dependencies:

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config \
  libglib2.0-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

If your distro does not have `libwebkit2gtk-4.1-dev`, try `libwebkit2gtk-4.0-dev`.

Quick check:

```bash
pkg-config --modversion glib-2.0
pkg-config --modversion webkit2gtk-4.1 || pkg-config --modversion webkit2gtk-4.0
```

## Dev

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

### Build Installers (Windows / macOS / Linux)

Tauri builds native bundles per platform. In practice, you build on each OS (or use CI runners for each OS).

**Output path**

After a successful build, artifacts are written to:

`src-tauri/target/release/bundle/`

Typical outputs include:

- **Windows**: `*.exe` (installer) and/or `*.msi`
- **macOS**: `*.app` and/or `*.dmg`
- **Linux**: `*.AppImage`, `*.deb`, and/or `*.rpm`

### Windows

1. Install prerequisites:
   - Rust toolchain (MSVC)
   - Visual Studio Build Tools (Desktop development with C++)
   - Microsoft Edge WebView2 Runtime (usually already installed on Windows 10/11)
2. Build:

```powershell
npm install
npm run tauri build
```

Artifacts are under `src-tauri/target/release/bundle/`.

### macOS

1. Install prerequisites:
   - Xcode Command Line Tools (`xcode-select --install`) or full Xcode
   - Rust toolchain
2. Build:

```bash
npm install
npm run tauri build
```

Artifacts are under `src-tauri/target/release/bundle/` (e.g. `.app`, `.dmg`).

### Linux

1. Install system dependencies (Ubuntu/Debian example):

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config \
  libglib2.0-dev \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

If your distro does not have `libwebkit2gtk-4.1-dev`, try `libwebkit2gtk-4.0-dev`.

2. Build:

```bash
npm install
npm run tauri build
```

Artifacts are under `src-tauri/target/release/bundle/` (e.g. `.AppImage`, `.deb`, `.rpm`).
