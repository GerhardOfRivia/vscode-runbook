#!/usr/bin/env sh
# vscode-runbook installer - https://github.com/GerhardOfRivia/vscode-runbook
# Usage: curl -fsSL https://raw.githubusercontent.com/GerhardOfRivia/vscode-runbook/refs/heads/main/install.sh | sh

set -e

REPO="GerhardOfRivia/vscode-runbook"
BINARY_NAME="vscode-runbook"
INSTALL_DIR="${VSCODE_RUNBOOK_INSTALL_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
    exit 1
}

# Get latest release version
# Primary: parse the 302 redirect on /releases/latest (no API call, no rate limit).
# Fallback: the GitHub REST API (subject to 60 req/hour anonymous limit).
get_latest_version() {
    # Try the web redirect first — does not count against the API rate limit.
    VERSION=$(curl -sI "https://github.com/${REPO}/releases/latest" \
        | grep -i '^location:' \
        | sed -E 's|.*/tag/([^[:space:]]+).*|\1|' \
        | tr -d '\r')

    # Fallback to the REST API if the redirect didn't yield a tag.
    if [ -z "$VERSION" ]; then
        warn "Redirect lookup failed, falling back to GitHub API..."
        VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
            | grep '"tag_name":' \
            | sed -E 's/.*"([^"]+)".*/\1/')
    fi

    if [ -z "$VERSION" ]; then
        error "Failed to get latest version (GitHub API may be rate-limited; set RTK_VERSION=vX.Y.Z to pin)"
    fi
}

# Download and install
install() {
    info "Version: $VERSION"

    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY_NAME}-${VERSION}.vsix"
    CHECKSUMS_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"
    TEMP_DIR=$(mktemp -d)
    ARCHIVE="${TEMP_DIR}/${BINARY_NAME}-${VERSION}.vsix"
    CHECKSUMS="${TEMP_DIR}/checksums.txt"
    ASSET_NAME="${BINARY_NAME}-${VERSION}.vsix"

    info "Downloading from: $DOWNLOAD_URL"
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE"; then
        error "Failed to download binary"
    fi

    info "Downloading checksums..."
    if ! curl -fsSL "$CHECKSUMS_URL" -o "$CHECKSUMS"; then
        error "Failed to download checksums.txt — refusing to install unverified binary (set VSCODE_RUNBOOK_SKIP_CHECKSUM=1 to bypass at your own risk)"
    fi

    if [ "${VSCODE_RUNBOOK_SKIP_CHECKSUM:-0}" = "1" ]; then
        warn "VSCODE_RUNBOOK_SKIP_CHECKSUM=1 set — SKIPPING checksum verification (NOT RECOMMENDED)"
    else
        info "Verifying SHA-256 checksum..."
        EXPECTED=$(grep "[[:space:]]release/${ASSET_NAME}\$" "$CHECKSUMS" | awk '{print $1}')
        if [ -z "$EXPECTED" ]; then
            error "checksum for release/${ASSET_NAME} not found in checksums.txt — refusing to install"
        fi
        # sha256sum (Linux GNU) vs shasum -a 256 (macOS) — prefer whichever is available.
        if command -v sha256sum >/dev/null 2>&1; then
            ACTUAL=$(sha256sum "$ARCHIVE" | awk '{print $1}')
        elif command -v shasum >/dev/null 2>&1; then
            ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
        else
            error "Neither sha256sum nor shasum available — cannot verify checksum"
        fi
        if [ "$EXPECTED" != "$ACTUAL" ]; then
            error "checksum mismatch! expected=${EXPECTED} actual=${ACTUAL} — refusing to install"
        fi
        info "Checksum verified."
    fi

    # install extension
    if command -v code >/dev/null 2>&1; then
        info "Installing extension..."
        code --install-extension "${ARCHIVE}" >/dev/null 2>&1
    else
        error "code not found — cannot install extension"
    fi

    # Cleanup
    rm -rf "$TEMP_DIR"

    info "Successfully installed vs-code extension ${BINARY_NAME}"
}

# Verify installation
verify() {
    if code --list-extensions | grep -q "${BINARY_NAME}"; then
        info "Verification: vs-code extension ${BINARY_NAME} is installed"
    else
        error "vs-code extension ${BINARY_NAME} not installed"
    fi
}

main() {
    info "Installing vs-code extension $BINARY_NAME..."

    if [ -n "$VSCODE_RUNBOOK_VERSION" ]; then
        VERSION="$VSCODE_RUNBOOK_VERSION"
        info "Using pinned version from VSCODE_RUNBOOK_VERSION: $VERSION"
    else
        get_latest_version
    fi
    install
    verify

    echo ""
    info "Installation complete!"
}

main