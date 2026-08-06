# Pinned by digest, not just by tag.
#
# A tag is a mutable pointer. `node:22-bookworm-slim` resolves to whatever the
# publisher last pushed there, so two people running `lab` a month apart got
# different boxes, and a compromised or moved tag would land inside the very
# tool whose job is to contain untrusted code. That is the one place in this
# stack where "latest" is least defensible.
#
# The digest below is the multi-arch index for node:22-bookworm-slim, so it
# still resolves correctly on both arm64 and amd64.
#
# REFRESH IT DELIBERATELY. A pin that never moves means a base image that never
# gets security updates, which is the opposite failure. Re-pin when you think
# about it, and rebuild with `lab --rebuild`:
#
#   TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | jq -r .token)
#   curl -sI -H "Authorization: Bearer $TOKEN" \
#     -H "Accept: application/vnd.oci.image.index.v1+json" \
#     https://registry-1.docker.io/v2/library/node/manifests/22-bookworm-slim \
#     | grep -i docker-content-digest
#
# Last pinned: 2026-08-06
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

# A usable-but-minimal dev box. git/unzip to get code in, curl/less/vim to poke at it,
# jq for the recon pass. Add languages your world needs (python3, go, …) as you like.
#
# Note these are NOT version-pinned. Full reproducibility would need pinned apt
# versions plus a snapshot mirror, which is a lot of machinery for a box that is
# destroyed after every run and has no network by default. The digest pin above
# is where the supply-chain risk actually concentrates; this line is where the
# cost of pinning would exceed the benefit. Said out loud rather than left for
# someone to assume the pin covers more than it does.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates unzip curl less vim-tiny jq \
    && rm -rf /var/lib/apt/lists/*

# Runs as root, but the wrapper drops ALL Linux capabilities + sets no-new-privileges, so
# this root has no kernel power. That (plus no network, nothing mounted, disposable) is the
# wall. Root-inside keeps cloned/copied code writable so `npm install` actually works.
WORKDIR /work
CMD ["bash"]
