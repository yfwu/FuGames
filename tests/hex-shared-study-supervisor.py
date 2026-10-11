#!/usr/bin/env python3
"""Fixed136-game schedule. Start two jobs; a root-approved release enables three."""
import datetime, json, os, pathlib, subprocess, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/hex-shared-core-2026-10-11'
RELEASE = pathlib.Path('/tmp/hex-shared-third-worker.release')
assert not (OUT / 'execution.json').exists(), 'Do not overwrite an existing study execution'
assert not RELEASE.exists(), 'Remove a stale release flag before a new run'
JOBS = [(name, shard, shards) for name, shards in [('normal', 2), ('matrix', 2), ('control', 1), ('candidate', 3), ('mixed', 3)] for shard in range(shards)]
manifest = {'status': 'running', 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'ordering': JOBS, 'initialWorkers': 2, 'thirdWorkerReleasedUtc': None, 'jobs': []}
active = []
def save():
    (OUT / 'execution.json').write_text(json.dumps(manifest, indent=2) + '\n')
save()
try:
    while JOBS or active:
        limit = 3 if RELEASE.exists() else 2
        if limit == 3 and manifest['thirdWorkerReleasedUtc'] is None:
            manifest['thirdWorkerReleasedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        while JOBS and len(active) < limit:
            batch, shard, shards = JOBS.pop(0)
            command = ['node', 'tests/hex-shared-study.cjs', '--batch', batch, '--shard', str(shard), '--shards', str(shards)]
            log = (OUT / f'study-{batch}-{shard}.log').open('w')
            proc = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            row = {'batch': batch, 'shard': shard, 'shards': shards, 'pid': proc.pid, 'status': 'running', 'startedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': command}
            manifest['jobs'].append(row); active.append((proc, log, row)); print('started', batch, shard, 'pid', proc.pid, flush=True); save()
        for proc, log, row in active[:]:
            code = proc.poll()
            if code is not None:
                log.close(); active.remove((proc, log, row)); row.update(exitCode=code, status='completed' if code == 0 else 'failed', finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat()); save(); print('finished', row['batch'], row['shard'], code, flush=True)
                if code:
                    raise RuntimeError(f"Study process failed: {row['batch']}/{row['shard']}; preserve outcomes and inspect log")
        time.sleep(.5)
    manifest['status'] = 'complete'
finally:
    for proc, log, row in active:
        if proc.poll() is None:
            proc.terminate(); proc.wait(); row['status'] = 'interrupted'; row['exitCode'] = proc.returncode
        log.close()
    if manifest['status'] != 'complete': manifest['status'] = 'interrupted'
    manifest['finishedUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); save()
