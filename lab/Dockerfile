FROM node:22-bookworm-slim

# A usable-but-minimal dev box. git/unzip to get code in, curl/less/vim to poke at it,
# jq for the recon pass. Add languages your world needs (python3, go, …) as you like.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates unzip curl less vim-tiny jq \
    && rm -rf /var/lib/apt/lists/*

# Runs as root, but the wrapper drops ALL Linux capabilities + sets no-new-privileges, so
# this root has no kernel power. That (plus no network, nothing mounted, disposable) is the
# wall. Root-inside keeps cloned/copied code writable so `npm install` actually works.
WORKDIR /work
CMD ["bash"]
