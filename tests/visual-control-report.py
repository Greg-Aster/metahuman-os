"""Render the opt-in recorded demonstration's evidence; never controls a body."""
import hashlib
import configparser
import csv
import html
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys

output, gateway = map(Path, sys.argv[1:3])


def audit_targets(report, gt_path):
    """Offline scoring only. Reference annotations never enter the controller."""
    config = configparser.ConfigParser()
    config.read(gt_path.parent / 'seqinfo.ini')
    width = config.getint('Sequence', 'imWidth')
    height = config.getint('Sequence', 'imHeight')
    rows = {}
    for row in csv.reader(gt_path.open()):
        if row[6] == '1' and row[7] == '1':
            rows.setdefault(int(row[0]), []).append({'id': int(row[1]), 'visibility': float(row[8]),
                'box': [float(row[index]) / scale for index, scale in zip([2, 3, 4, 5], [width, height, width, height])]})

    def iou(a, b):
        intersection = max(0, min(a[0]+a[2], b[0]+b[2])-max(a[0], b[0])) * max(0, min(a[1]+a[3], b[1]+b[3])-max(a[1], b[1]))
        return intersection / (a[2]*a[3]+b[2]*b[3]-intersection) if intersection else 0

    audit = []
    for frame in report['frames']:
        candidates = rows.get(frame['videoFrame'] + 1, [])
        # Same first label-matching box used by the existing active behavior.
        objects = [obj for obj in frame['objects'] if obj['label'].lower() == 'person' and obj.get('box')]
        boxes = [[obj['box'][key] for key in ['x', 'y', 'width', 'height']] for obj in objects]
        selected = max(candidates, key=lambda row: iou(boxes[0], row['box']), default=None) if boxes else None
        overlap = iou(boxes[0], selected['box']) if selected else 0
        # Pedestrian 4 has annotated occlusion and reappearance in this clip.
        reference = next((row for row in candidates if row['id'] == 4), None)
        reference_overlap = max((iou(box, reference['box']) for box in boxes), default=0) if reference else None
        audit.append({'counter': frame['counter'], 'mediaTimeMs': frame['mediaTimeMs'], 'detections': len(objects),
            'selectedReferenceId': selected['id'] if selected and overlap >= .3 else None, 'selectedIoU': overlap,
            'occlusionReferenceId': 4, 'referenceVisibility': reference['visibility'] if reference else None,
            'referenceDetectionIoU': reference_overlap})
    ids = [frame['selectedReferenceId'] for frame in audit]
    switches = sum(a is not None and b is not None and a != b for a, b in zip(ids, ids[1:]))
    result = {'method': 'Independent per-frame maximum IoU >= 0.3 against marked pedestrian reference boxes; not an identity model or input to steering.',
        'referenceSha256': hashlib.sha256(gt_path.read_bytes()).hexdigest(), 'selectedIdSwitches': switches,
        'distinctMatchedIds': sorted(set(ids) - {None}), 'unmatchedSelections': ids.count(None), 'frames': audit,
        'stableTargetQualification': 'failed' if switches else 'not established by this overlap-only audit'}
    (output / 'target-audit.json').write_text(json.dumps(result, indent=2))
    return {key: value for key, value in result.items() if key != 'frames'}


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
natural = bool(reports and reports[0]['recognition'].get('video'))
assert len(reports) == (1 if natural else 3) and all(report['completed'] for report in reports)
summary = {'core': snapshot(Path.cwd()), 'gateway': snapshot(gateway), 'cases': []}
page = ['<!doctype html><meta charset="utf-8"><title>Recorded visual control</title>',
        '<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;background:#101820;color:#eef} '
        'section{margin:32px 0} .frames{display:flex;flex-wrap:wrap;gap:12px} figure{margin:0;width:340px} '
        'img{width:100%} pre{white-space:pre-wrap} a{color:#8cf}</style>',
        '<h1>Real recognition → existing behavior → simulated commands</h1>',
        '<p>Natural MOT17-13 raw video, sampled at native wall-clock playback time. Multiple people and moving camera; no crops or artificial occlusion. '
        'Class selection is audited independently; a software pass is not stable-target qualification.</p>' if natural else
        '<p>One person cropped from the public Ultralytics bus photo is translated left/center/right, then removed. '
        'Boxes are actual offline YOLO results. This is a controlled pixel replay, not natural video or identity tracking. '
        'Interpretation and conversation provider completions are deliberately held pending. No physical destination exists.</p>']
for report in reports:
    ages = [frame['observationAgeMs'] for frame in report['frames']]
    inference = [frame['processing']['inferenceMs'] for frame in report['frames']]
    commands = report['commands']
    # Exclude the initial graph admission from ongoing-control latency.
    ongoing = [cmd['frameToCommandMs'] for cmd in commands if cmd['frameCounter'] > 1]
    item = {'case': report['ending'], 'frames': len(ages), 'inferenceMedianMs': statistics.median(inference), 'inferenceMaxMs': max(inference),
            'observationAgeMedianMs': statistics.median(ages), 'observationAgeMaxMs': max(ages),
            'frameToCommandMedianMs': statistics.median(ongoing), 'frameToCommandMaxMs': max(ongoing),
            'freshFps': report['lastMetrics']['freshFps'], 'targetLossResponseMs': report.get('targetLossResponseMs'),
            'expiryToCancellationMs': report['expiryToCancellationMs'] if report['deadlineRequestedCancellation'] else None,
            'cancelToStopMs': report['stopSentAt'] - report['cancelRequestedAt'],
            'cancelToResultMs': report['cancelToResultMs'], 'result': report['termination']['type'],
            'pendingAtCancellation': report['pendingAtCancellation'], 'model': report['recognition']['model']}
    summary['cases'].append(item)
    if natural:
        item['sourceSha256'] = report['recognition']['sourceSha256']
        item['maximumSourceFrameGapMs'] = max(b['mediaTimeMs'] - a['mediaTimeMs'] for a, b in zip(report['frames'], report['frames'][1:]))
        item['multiPersonFrames'] = sum(len(frame['objects']) > 1 for frame in report['frames'])
        item['emptyFrames'] = sum(not frame['objects'] for frame in report['frames'])
        if len(sys.argv) > 3 and sys.argv[3]:
            item['targetAudit'] = audit_targets(report, Path(sys.argv[3]))
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
