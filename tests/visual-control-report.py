"""Render the opt-in recorded demonstration's evidence; never controls a body."""
import hashlib
import html
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys

output, gateway = map(Path, sys.argv[1:])


def snapshot(root):
    # HEAD identifies unchanged files. Hash each changed/new file, preserving
    # deletions explicitly; do not reread unrelated CAD or private backups.
    paths = os.fsdecode(subprocess.check_output(['git', 'diff', '--name-only', '-z', 'HEAD'], cwd=root)).split('\0')
    paths += os.fsdecode(subprocess.check_output(['git', 'ls-files', '-o', '--exclude-standard', '-z'], cwd=root)).split('\0')
    hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() if (root / name).is_file() else None
              for name in sorted(set(paths)) if name and not name.startswith('etc/.backups/')}
    identity = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(), 'files': hashes}
    return {**identity, 'sourceSha256': hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()}


reports = [json.loads(file.read_text()) for file in sorted(output.glob('*/trace.json'))]
assert len(reports) == 3 and all(report['completed'] for report in reports)
summary = {'core': snapshot(Path.cwd()), 'gateway': snapshot(gateway), 'cases': []}
page = ['<!doctype html><meta charset="utf-8"><title>Recorded visual control</title>',
        '<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;background:#101820;color:#eef} '
        'section{margin:32px 0} .frames{display:flex;flex-wrap:wrap;gap:12px} figure{margin:0;width:340px} '
        'img{width:100%} pre{white-space:pre-wrap} a{color:#8cf}</style>',
        '<h1>Real recognition → existing behavior → simulated commands</h1>',
        '<p>One person cropped from the public Ultralytics bus photo is translated left/center/right, then removed. '
        'Boxes are actual offline YOLO results. This is a controlled pixel replay, not natural video or identity tracking. '
        'Interpretation and conversation provider completions are deliberately held pending. No physical destination exists.</p>']
for report in reports:
    ages = [frame['observationAgeMs'] for frame in report['frames']]
    inference = [frame['processing']['inferenceMs'] for frame in report['frames']]
    commands = report['commands']
    # Exclude the initial graph admission from ongoing-control latency.
    ongoing = [cmd['frameToCommandMs'] for cmd in commands if cmd['frameCounter'] > 1]
    item = {'case': report['ending'], 'frames': len(ages), 'inferenceMedianMs': statistics.median(inference),
            'observationAgeMedianMs': statistics.median(ages), 'observationAgeMaxMs': max(ages),
            'frameToCommandMedianMs': statistics.median(ongoing), 'frameToCommandMaxMs': max(ongoing),
            'freshFps': report['lastMetrics']['freshFps'], 'targetLossResponseMs': report['targetLossResponseMs'],
            'expiryToCancellationMs': report['expiryToCancellationMs'] if report['deadlineRequestedCancellation'] else None,
            'cancelToStopMs': report['stopSentAt'] - report['cancelRequestedAt'],
            'cancelToResultMs': report['cancelToResultMs'], 'result': report['termination']['type'],
            'pendingAtCancellation': report['pendingAtCancellation'], 'model': report['recognition']['model']}
    summary['cases'].append(item)
    name = report['ending']
    page.extend([f'<section><h2>{name}</h2><pre>{html.escape(json.dumps(item, indent=2))}</pre>', '<div class="frames">'])
    for frame in report['frames']:
        counter = frame['counter']
        action = next((cmd for cmd in reversed(commands) if cmd['frameCounter'] == counter), None)
        turn = action['action']['movementUpdate']['controls']['turn'] if action else None
        caption = f"Frame {counter}: {len(frame['objects'])} detections; age {frame['observationAgeMs']} ms; turn {turn:.2f}" if turn is not None else f'Frame {counter}'
        page.append(f'<figure><img src="{name}/{counter:03}-detected.jpg"><figcaption>{html.escape(caption)}</figcaption></figure>')
    page.append(f'</div><p><a href="{name}/trace.json">Full correlated trace</a></p></section>')
page.append('<p>Terminal receipts establish commanded outcomes, not physical rest. Loss of a detected target uses the selected base motion; only expired required feedback requests cancellation. Timings include a test driver servicing the real Coordinator handlers and are not deployed scheduling guarantees.</p>')
(output / 'index.html').write_text('\n'.join(page))
(output / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({**summary, 'core': {k: v for k, v in summary['core'].items() if k != 'files'},
                  'gateway': {k: v for k, v in summary['gateway'].items() if k != 'files'}}, indent=2))
print(f"Visual report: {output / 'index.html'}")
