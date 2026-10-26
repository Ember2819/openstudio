#!/usr/bin/env sh
# One-command bootstrap: installs Node.js/npm if they are missing, then installs
# dependencies and starts OpenStudio. Everything is idempotent, so you can also
# use it to relaunch the app later.
set -eu

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js / npm not found — installing…"
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y nodejs npm
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y nodejs npm
    elif command -v dnf5 >/dev/null 2>&1; then
        sudo dnf5 install -y nodejs npm
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -Sy --noconfirm nodejs npm
    elif command -v zypper >/dev/null 2>&1; then
        sudo zypper install -y nodejs npm
    elif command -v brew >/dev/null 2>&1; then
        brew install node
    else
        echo "Please install Node.js 22+ from https://nodejs.org and re-run." >&2
        exit 1
    fi
fi

if ! npm --version >/dev/null 2>&1; then
    echo "Node.js is installed but npm is missing. Install npm with your package manager and re-run." >&2
    exit 1
fi

npm install
npm start
