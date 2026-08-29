# Shared bootstrap, sourced by install-macos.command and install-linux.sh.
#
# Plain POSIX shell on purpose: it is the one thing every target already has,
# and its only job is to make sure a usable Node exists before handing over to
# the installer proper, which is written in cross-platform JavaScript.
#
# Nothing here is installed system-wide. A Node fetched by this script lives
# inside the pharmacy folder and is deleted with it.

set -eu

NODE_MAJOR_MIN=20
NODE_VERSION="v22.20.0"

say() { printf '   %s\n' "$*"; }
die() { printf '\nStopped. %s\n\n' "$*" >&2; exit 1; }

find_node() {
  command -v node >/dev/null 2>&1 || return 1
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge "$NODE_MAJOR_MIN" ] 2>/dev/null || return 1
  NODE_BIN="$(command -v node)"
  return 0
}

fetch_node() {
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) die "unsupported system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) die "unsupported processor: $(uname -m)" ;;
  esac

  archive="node-${NODE_VERSION}-${os}-${arch}.tar.gz"
  url="https://nodejs.org/dist/${NODE_VERSION}/${archive}"
  runtime_dir="${INSTALL_DIR}/runtime"

  say "Node is not installed, or is too old. Fetching one for the pharmacy."
  say "It goes in ${runtime_dir} and is removed when you uninstall."
  mkdir -p "${runtime_dir}"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "${runtime_dir}/${archive}" || die "could not download Node from ${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "${runtime_dir}/${archive}" || die "could not download Node from ${url}"
  else
    die "neither curl nor wget is available, so Node cannot be downloaded.
Install Node 22 from https://nodejs.org and run this again."
  fi

  tar -xzf "${runtime_dir}/${archive}" -C "${runtime_dir}" || die "could not unpack Node"
  rm -f "${runtime_dir}/${archive}"

  NODE_BIN="${runtime_dir}/node-${NODE_VERSION}-${os}-${arch}/bin/node"
  [ -x "$NODE_BIN" ] || die "the downloaded Node does not run"
  PATH="$(dirname "$NODE_BIN"):$PATH"
  export PATH
  say "Node ${NODE_VERSION} ready."
}

bootstrap() {
  SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
  INSTALL_DIR="${PHARMACY_DIR:-$HOME/pharmacy}"
  mkdir -p "$INSTALL_DIR"

  if ! find_node; then
    fetch_node
  fi

  exec "$NODE_BIN" "${SOURCE_DIR}/installer/main.mjs" \
    --source "$SOURCE_DIR" --dir "$INSTALL_DIR" "$@"
}
