#!/usr/bin/env bash
set -euo pipefail
# Run from an extracted copy of THIS package. Touches only doctorfizz-llm.
task_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_target_dir=/opt/doctorfizz-llm-visibility/doctorfizz-visibility
if [[ "$task_source_dir" == "$task_target_dir" ]]; then
  echo 'Extract this package to /root/doctorfizz-browser first; do not overwrite the existing app before backing it up.' >&2
  exit 1
fi
if [[ ! -f "$task_target_dir/.env" || ! -f "$task_target_dir/compose.yaml" ]]; then
  echo 'Existing VPS app and .env were not found at the expected path. No files changed.' >&2
  exit 1
fi
task_backup_dir="/root/doctorfizz-browser-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$task_backup_dir"
cd "$task_target_dir"
umask 077
docker compose -p doctorfizz-llm exec -T postgres pg_dump -U doctorfizz doctorfizz > "$task_backup_dir/database.sql"
tar --exclude='./node_modules' --exclude='./.next' --exclude='./.git' --exclude='./test-results' --exclude='./playwright-report' -czf "$task_backup_dir/source.tar.gz" .
echo "Source and database backups saved: $task_backup_dir"
python3 - "$task_source_dir" "$task_target_dir" <<'PY'
from pathlib import Path
import shutil,sys
source,target=map(Path,sys.argv[1:])
for item in source.iterdir():
    if item.name in {'.env','.git','node_modules','.next','test-results','playwright-report','internal-debug'}: continue
    destination=target/item.name
    if item.is_dir(): shutil.copytree(item,destination,dirs_exist_ok=True)
    else: shutil.copy2(item,destination)
for retired in ('src/app/api/prompts/custom','src/app/api/prompts/regenerate'):
    shutil.rmtree(target/retired,ignore_errors=True)
(target/'src/lib/prompts.ts').unlink(missing_ok=True)
path=target/'.env'
lines=path.read_text().splitlines()
changes={'BACKEND_URL':'','TURNSTILE_REQUIRED':'false','MAX_PENDING_CHECKS':'1','DOCTORFIZZ_WEB_PORT':'8089','HEALTH_CHECK_ENABLED':'false'}
lines=[line for line in lines if line.split('=',1)[0] not in changes]
lines.extend(key+'='+value for key,value in changes.items())
# Browser worker settings: add only when missing so operator values survive upgrades.
present={line.split('=',1)[0]:line.split('=',1)[1] if '=' in line else '' for line in lines}
proxy=present.get('RESIDENTIAL_PROXY_URL','').strip()
defaults={'BROWSER_LOCALE':'en-IN','BROWSER_TIMEZONE':'Asia/Kolkata','BROWSER_HEADLESS':'false','BROWSER_BLOCK_RETRIES':'1','RESIDENTIAL_PROXY_URL':'','REQUIRE_PROXY':'true' if proxy else 'false'}
lines.extend(key+'='+value for key,value in defaults.items() if key not in present)
if not proxy:
    print('WARNING: RESIDENTIAL_PROXY_URL is empty; the worker will browse from the VPS IP. Set RESIDENTIAL_PROXY_URL=... and REQUIRE_PROXY=true in '+str(path)+', then run from that folder: docker compose -p doctorfizz-llm up -d --no-deps worker && docker compose -p doctorfizz-llm logs worker | grep browser_egress')
path.write_text('\n'.join(lines)+'\n');path.chmod(0o600)
print('Browser runtime settings saved; existing runtime secrets retained.')
PY
docker compose -p doctorfizz-llm config --quiet
docker compose -p doctorfizz-llm build web worker migrate
# No down, prune, volume removal, Caddy edits, or changes to other projects.
docker compose -p doctorfizz-llm up -d web worker
docker compose -p doctorfizz-llm ps
echo 'Browser upgrade started. Next run the health check and browser acceptance probe in docs/DEPLOYMENT_VPS_VERCEL.md.'
