#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
platform="${SKAZ_PLATFORM:-linux/amd64}"
image="${SKAZ_IMAGE:-skaz:local}"
include_postgres="${INCLUDE_POSTGRES:-0}"
skip_build="${SKAZ_SKIP_BUILD:-0}"
output="${1:-$repo_root/work/skaz-offline-${platform//\//-}}"

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# -le 1 ]] || fail "Использование: scripts/skaz-build-offline.sh [новый каталог пакета]"
[[ "$platform" =~ ^[a-z0-9]+/[a-z0-9_]+(/[a-z0-9._-]+)?$ ]] || fail "Некорректная платформа: $platform"
[[ "$include_postgres" == 0 || "$include_postgres" == 1 ]] || fail "INCLUDE_POSTGRES должен быть 0 или 1."
[[ "$skip_build" == 0 || "$skip_build" == 1 ]] || fail "SKAZ_SKIP_BUILD должен быть 0 или 1."
[[ ! -e "$output" && ! -L "$output" ]] || fail "Каталог пакета уже существует: $output"
for command in docker node git gzip; do command -v "$command" >/dev/null || fail "Не найдена команда: $command"; done
if command -v sha256sum >/dev/null; then
  checksum=(sha256sum)
elif command -v shasum >/dev/null; then
  checksum=(shasum -a 256)
else
  fail "Нужна команда sha256sum или shasum."
fi
for file in docker/Dockerfile.skaz docker/compose.skaz.yml docker/compose.skaz.postgres.yml docker/skaz.env.example docs/deploy/skaz-docker.ru.md; do
  [[ -f "$file" ]] || fail "Не найден файл: $file"
done

git_base="$(git rev-parse HEAD)"
dirty=0
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || dirty=1
mkdir -p "$(dirname "$output")"
stage="$(mktemp -d "$(dirname "$output")/.skaz-offline-package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

if [[ "$skip_build" == 0 ]]; then
  docker build --platform "$platform" --network "${SKAZ_BUILD_NETWORK:-default}" \
    --build-arg HTTP_PROXY --build-arg HTTPS_PROXY \
    --build-arg http_proxy --build-arg https_proxy \
    -f docker/Dockerfile.skaz -t "$image" .
fi

inspect_image() {
  docker image inspect --format '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"variant":{{json .Variant}},"repoDigests":{{json .RepoDigests}}}' "$1" > "$stage/$2"
  node - "$stage/$2" "$platform" "$1" <<'NODE'
const fs = require("node:fs");
const [file, expected, reference] = process.argv.slice(2);
const image = JSON.parse(fs.readFileSync(file, "utf8"));
const [os, architecture, variant] = expected.split("/");
if (image.os !== os || image.architecture !== architecture || (variant && image.variant !== variant)) {
  throw new Error(`Образ ${reference}: ${image.os}/${image.architecture}/${image.variant || ""}, требуется ${expected}`);
}
NODE
}

inspect_image "$image" .app-image.json
images=("$image")
if [[ "$include_postgres" == 1 ]]; then
  docker pull --platform "$platform" postgres:16-alpine
  inspect_image postgres:16-alpine .postgres-image.json
  images+=(postgres:16-alpine)
fi

docker save "${images[@]}" | gzip -n > "$stage/images.tar.gz"
cp docker/compose.skaz*.yml docker/skaz.env.example "$stage/"
cp docs/deploy/skaz-docker.ru.md "$stage/README.md"
node - "$stage" "$platform" "$git_base" "$dirty" "$skip_build" "${images[@]}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [directory, platform, gitBaseCommit, dirty, buildSkipped, ...references] = process.argv.slice(2);
const images = references.map((reference, index) => {
  const file = path.join(directory, index === 0 ? ".app-image.json" : ".postgres-image.json");
  const { id, os, architecture, variant, repoDigests } = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.unlinkSync(file);
  return { reference, id, os, architecture, variant: variant || "", repoDigests: repoDigests || [] };
});
const manifest = {
  formatVersion: 1, platform, gitBaseCommit, dirty: dirty === "1", buildSkipped: buildSkipped === "1",
  sourceNote: buildSkipped === "1"
    ? "Checkout metadata describes packaging files, not the source provenance of the existing image."
    : "gitBaseCommit is the checkout base; dirty=true means uncommitted local changes were included in the build context.",
  images,
};
fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
NODE
(
  cd "$stage"
  "${checksum[@]}" README.md compose.skaz*.yml skaz.env.example images.tar.gz manifest.json > SHA256SUMS
)
# Directory rename fails rather than overwriting a file or a nonempty delivery.
node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$stage" "$output"
trap - EXIT
printf 'Офлайн-пакет готов: %s\n' "$output"
