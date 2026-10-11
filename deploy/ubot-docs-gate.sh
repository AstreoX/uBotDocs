#!/bin/bash
# Forced command for the GitHub Actions deploy key (see deploy/README.md).
#
# authorized_keys of the deploy user:
#   restrict,command="/usr/local/bin/ubot-docs-gate /srv/ubot-docs" ssh-ed25519 AAAA... github-actions-deploy
#
# Allows exactly two things:
#   rsync --server ... . <root>/releases/<40-hex sha>/   upload one release (no downloads, no other paths)
#   activate <40-hex sha>                                 point <root>/current at that release atomically,
#                                                         then keep only the newest $KEEP releases
set -euo pipefail

ROOT="${1:?usage: ubot-docs-gate <deploy root> [releases to keep]}"
ROOT="${ROOT%/}"
KEEP="${2:-5}"
CMD="${SSH_ORIGINAL_COMMAND:-}"

deny() {
  echo "ubot-docs-gate: denied: $1" >&2
  exit 1
}

case "$CMD" in
  "activate "*)
    sha="${CMD#activate }"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || deny "release id must be a full commit sha"
    [ -f "$ROOT/releases/$sha/index.html" ] || deny "release $sha is not uploaded (no index.html)"
    touch "$ROOT/releases/$sha"
    ln -sfn "releases/$sha" "$ROOT/current.new"
    mv -Tf "$ROOT/current.new" "$ROOT/current"
    active="$(readlink "$ROOT/current")"
    # Newest first by modification time; the active release is never removed.
    ls -1dt "$ROOT"/releases/*/ | tail -n +"$((KEEP + 1))" | while read -r dir; do
      dir="${dir%/}"
      [ "releases/$(basename "$dir")" = "$active" ] && continue
      rm -rf -- "$dir"
    done
    echo "activated $sha"
    ;;

  "rsync --server "*)
    read -r -a words <<< "$CMD"
    n=${#words[@]}
    (( n >= 4 )) || deny "incomplete rsync command"
    [ "${words[n-2]}" = "." ] || deny "unexpected rsync arguments"
    dest="${words[n-1]}"
    case "$dest" in
      "$ROOT/releases/"*) ;;
      *) deny "destination must be under $ROOT/releases/" ;;
    esac
    rel="${dest#"$ROOT/releases/"}"
    rel="${rel%/}"
    [[ "$rel" =~ ^[0-9a-f]{40}$ ]] || deny "destination must be $ROOT/releases/<commit sha>/"
    for w in "${words[@]:2:n-4}"; do
      case "$w" in
        --sender | --remove-source-files) deny "option $w" ;;
      esac
      [[ "$w" =~ ^(-[A-Za-z.]+|--delete|--delete-(before|during|after|delay)|--chmod=[DF0-9,]+|--partial|--no-[a-z-]+)$ ]] || deny "option $w"
    done
    mkdir -p "$ROOT/releases"
    exec "${words[@]}"
    ;;

  *)
    deny "only rsync uploads and 'activate <sha>' are allowed"
    ;;
esac
