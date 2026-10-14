#!/usr/bin/env bash
set -euo pipefail
# Run from an extracted release. Only the doctorfizz-llm project is addressed.
task_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_target_dir=/opt/doctorfizz-llm-visibility/doctorfizz-visibility
if [[ "$task_source_dir" == "$task_target_dir" ]]; then
  echo 'Extract the repair package outside the live app directory first.' >&2
  exit 1
fi
if [[ ! -f "$task_target_dir/.env" || ! -f "$task_target_dir/compose.yaml" ]]; then
  echo 'Existing app and .env were not found. No files changed.' >&2
  exit 1
fi
if [[ ! -f "$task_source_dir/RELEASE_SHA256SUMS" ]]; then
  echo 'Release checksum manifest is missing. No files changed.' >&2
  exit 1
fi
(cd "$task_source_dir" && sha256sum --check --quiet RELEASE_SHA256SUMS)
cd "$task_target_dir"
exec 9>/root/doctorfizz-reliability-upgrade.lock
flock -n 9 || { echo 'An upgrade is already running.' >&2; exit 1; }
docker compose -p doctorfizz-llm config --quiet
# Do not interrupt a user's unfinished batch.
task_active="$(docker compose -p doctorfizz-llm exec -T postgres psql -U doctorfizz -d doctorfizz -Atc "SELECT count(*) FROM checks WHERE status!='completed' AND deadline_at>now()")"
if [[ "$task_active" != "0" ]]; then
  echo 'There are active checks. Let them finish before installing; no files changed.' >&2
  exit 1
fi
umask 077
task_backup_dir="/root/doctorfizz-reliability-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$task_backup_dir"
docker compose -p doctorfizz-llm exec -T postgres pg_dump -U doctorfizz doctorfizz > "$task_backup_dir/database.sql"
tar --exclude='./node_modules' --exclude='./.next' --exclude='./.git' --exclude='./internal-debug' --exclude='./test-results' --exclude='./playwright-report' -czf "$task_backup_dir/source.tar.gz" .
# Keep old images even when Compose build replaces their normal tags.
for task_service in web worker; do
  task_container="$(docker compose -p doctorfizz-llm ps -aq "$task_service")"
  if [[ -z "$task_container" ]]; then
    echo "Missing existing $task_service container; no application files changed." >&2
    exit 1
  fi
  docker inspect --format '{{.Image}}' "$task_container" > "$task_backup_dir/$task_service.image-id"
  docker inspect --format '{{.Config.Image}}' "$task_container" > "$task_backup_dir/$task_service.image-name"
  docker image tag "$(cat "$task_backup_dir/$task_service.image-id")" "doctorfizz-reliability-rollback-$task_service:$(basename "$task_backup_dir")"
done
cat > "$task_backup_dir/rollback.sh" <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
backup="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd /opt/doctorfizz-llm-visibility/doctorfizz-visibility
tar -xzf "$backup/source.tar.gz"
for service in web worker; do
  docker image tag "$(cat "$backup/$service.image-id")" "$(cat "$backup/$service.image-name")"
done
docker compose -p doctorfizz-llm up -d --no-deps --force-recreate web worker
ROLLBACK
chmod 700 "$task_backup_dir/rollback.sh"
task_started=0
rollback_on_error() {
  task_status=$?
  trap - ERR
  echo "Upgrade failed. Restoring the previous source and images from $task_backup_dir" >&2
  if [[ "$task_started" == "1" ]]; then
    bash "$task_backup_dir/rollback.sh" || echo 'Automatic rollback failed; inspect this project before retrying.' >&2
  else
    tar -xzf "$task_backup_dir/source.tar.gz"
    for task_service in web worker; do
      docker image tag "$(cat "$task_backup_dir/$task_service.image-id")" "$(cat "$task_backup_dir/$task_service.image-name")"
    done
  fi
  exit "$task_status"
}
trap rollback_on_error ERR
python3 - "$task_source_dir" "$task_target_dir" <<'PY'
from pathlib import Path
import shutil,sys
source,target=map(Path,sys.argv[1:])
for item in source.iterdir():
    if item.name in {'.env','.git','node_modules','.next','internal-debug','test-results','playwright-report'}: continue
    if item.name.startswith('.env') and item.name != '.env.example': continue
    if item.is_symlink(): raise ValueError('Release symlinks are not permitted')
    destination=target/item.name
    if item.is_dir(): shutil.copytree(item,destination,dirs_exist_ok=True)
    else: shutil.copy2(item,destination)
print('Release copied. Existing .env and credentials preserved.')
PY
docker compose -p doctorfizz-llm config --quiet
docker compose -p doctorfizz-llm build web worker
# Tests use local fixture pages and the actual tsx runtime in the new worker image.
docker compose -p doctorfizz-llm run --rm --no-deps -e PROXY_PROVIDERS= -e RESIDENTIAL_PROXY_URL= --entrypoint node worker --import tsx --test tests/worker-runtime.node.ts
task_started=1
docker compose -p doctorfizz-llm up -d --no-deps --force-recreate web worker
task_ready=0
for task_attempt in $(seq 1 15); do
  if docker compose -p doctorfizz-llm exec -T web node -e 'fetch("http://127.0.0.1:3000/api/health",{headers:{"x-doctorfizz-backend-key":process.env.BACKEND_SHARED_SECRET||""},signal:AbortSignal.timeout(5000)}).then(async r=>{const body=await r.json();if(r.ok&&body.release==="1.5.1"){console.log(JSON.stringify(body));process.exit(0)}process.exit(1)}).catch(()=>process.exit(1))'; then
    task_ready=1
    break
  fi
  sleep 2
done
[[ "$task_ready" == "1" ]]
trap - ERR
docker compose -p doctorfizz-llm exec -T worker npm run runtime:diagnose
echo "Installed v1.5.1. Backup and rollback command: bash $task_backup_dir/rollback.sh"
echo 'Deployment health passed. Live provider acceptance is still required.'
if [[ "${1:-}" == "--acceptance" ]]; then
  docker compose -p doctorfizz-llm exec -T worker npm run browser:acceptance -- --frontend --provider=gemini
fi
