# QueryPlus

QueryPlus is a cross-platform desktop app (Tauri v2) for managing database connections and running SQL.

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
