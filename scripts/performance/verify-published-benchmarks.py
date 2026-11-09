#!/usr/bin/env python3
"""Verify recorded evidence and recompute results; does not run a benchmark."""
import hashlib
import json
import math
import statistics
import tarfile
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_archive(path, expected_hash, entries=None):
    assert digest(path) == expected_hash, f"Archive hash mismatch: {path.name}"
    with tarfile.open(path) as archive:
        members = [member for member in archive.getmembers() if member.isfile()]
        assert all(not member.name.startswith('/') and '..' not in Path(member.name).parts for member in members)
        assert len({member.name for member in members}) == len(members)
        if entries is not None:
            expected = {entry.get('path', entry.get('archivePath')): entry for entry in entries}
            assert {member.name for member in members} == set(expected), 'Archive/index members differ'
            for member in members:
                entry = expected[member.name]
                assert member.size == entry['bytes'], member.name
                assert hashlib.sha256(archive.extractfile(member).read()).hexdigest() == entry['sha256'], member.name
        return {member.name: json.load(archive.extractfile(member)) for member in members if member.name.endswith('.json')}


def verify(root):
    evidence = root / 'docs/performance'
    load = lambda name: json.loads((evidence / name).read_text())
    discovery_index = load('rust-discovery-allocation-evidence-index.json')
    discovery = checked_archive(evidence / 'rust-discovery-allocation-evidence.tar.gz', discovery_index['archiveSha256'], discovery_index['entries'])
    ordinary, allocations = discovery['raw/ordinary.json'], discovery['raw/allocation.json']
    recorded = load('rust-discovery-allocation-summary.json')
    assert recorded == discovery['raw/summary.json']
    assert ordinary['complete'] and allocations['complete'] and recorded['complete']
    assert len(ordinary['rows']) == recorded['ordinaryRuns'] == 180
    assert len(allocations['rows']) == recorded['allocationRuns'] == 36
    assert len(recorded['rows']) == 18
    case_key = lambda row: tuple(row[field] for field in ['order', 'query', 'limit'])
    cases = {case_key(row) for row in recorded['rows']}
    assert len(cases) == 18
    assert cases == {case_key(row) for row in ordinary['rows']} == {case_key(row) for row in allocations['rows']}
    improved, reductions, slower = 0, [], []
    for case in recorded['rows']:
        key = tuple(case[field] for field in ['order', 'query', 'limit'])
        for mode in ['base', 'cand']:
            matches = lambda row: tuple(row[field] for field in ['order', 'query', 'limit']) == key and row['mode'] == mode
            normal = [row for row in ordinary['rows'] if matches(row)]
            diagnostic = [row for row in allocations['rows'] if matches(row)]
            assert len(normal) == 5 and {row['repeat'] for row in normal} == set(range(5))
            assert len(diagnostic) == 1
            for field in ['elapsedMs', 'kernelMaxRssKiB']:
                assert math.isclose(statistics.median(row[field] for row in normal), case[mode][field], abs_tol=1e-9)
            for field in ['allocations', 'cumulativeRequestedBytes', 'peakLiveRequestedBytes']:
                assert diagnostic[0][field] == case[mode][field]
        all_rows = [row for row in ordinary['rows'] + allocations['rows'] if tuple(row[field] for field in ['order', 'query', 'limit']) == key]
        assert len({row['wireSha256'] for row in all_rows}) == 1, 'Output differs between variants'
        reductions.append(100 * (1 - case['cand']['allocations'] / case['base']['allocations']))
        if case['cand']['elapsedMs'] < case['base']['elapsedMs']:
            improved += 1
        else:
            slower.append({'tree': key[0], 'query': key[1], 'limit': key[2]})
    assert improved == 15 and len(slower) == 3

    runtime_index = load('rust-runtime-guardian-integrated-evidence-index.json')
    runtime = checked_archive(evidence / 'rust-runtime-guardian-integrated-evidence.tar.gz', runtime_index['evidenceArchive']['sha256'], runtime_index['files'])
    checked_archive(evidence / 'rust-runtime-guardian-integrated-measured-source.tar.gz', runtime_index['measuredSourceArchive']['sha256'])
    summary = load('rust-runtime-guardian-integrated-summary.json')
    assert summary == runtime['run/performance/summary.json'] and summary['complete']
    assert {(row['mode'], row['repeat']) for row in summary['rows']} == {(mode, repeat) for mode in ['legacy', 'integrated'] for repeat in range(3)}
    assert len(summary['rows']) == 6
    medians = {'legacy': [], 'integrated': []}
    complete, rejected = 0, 0
    for mode in medians:
        for repeat in range(3):
            app = runtime[f'run/performance/desktop-{mode}-{repeat}.json']
            assert app['passed'] and all(app['checks'].values())
            assert len(app['phases']) == 6
            assert {phase['label'] for phase in app['phases']} == {'desktop-baseline', 'after-first-generation', 'after-idle', 'after-catalog', 'after-second-generation', 'after-stop'}
            rejected += len(app['rejectedSamples'])
            for phase in app['phases']:
                assert len(phase['samples']) == 5
                assert all(sample['tree']['complete'] and not sample['tree']['issues'] for sample in phase['samples'])
                values = [sample['tree']['totals']['pssKiB'] for sample in phase['samples']]
                recorded_app = next(row for row in summary['rows'] if row['mode'] == mode and row['repeat'] == repeat)
                assert statistics.median(values) == recorded_app['phases'][phase['label']]['treePssKiB']
                complete += len(values)
                if phase['label'] == 'after-idle':
                    medians[mode].append(statistics.median(values))
    assert complete == summary['completeSamples'] == 180 and summary['apps'] == 6 and rejected == 1
    before, after = (statistics.median(medians[mode]) / 1024 for mode in ['legacy', 'integrated'])
    assert round(before, 3) == 456.803 and round(after, 3) == 439.785
    return {
        'verified': True,
        'discovery': {'ordinaryRuns': 180, 'separateAllocationRuns': 36, 'allocationReductionPercent': [round(min(reductions), 2), round(max(reductions), 2)], 'fasterCaseMedians': improved, 'slowerCases': slower},
        'runtime': {'apps': 6, 'completePssSamples': complete, 'retainedRejectedSamples': rejected, 'idleAppModelPssMiB': [round(before, 3), round(after, 3)], 'differenceMiB': round(before - after, 3)},
        'scope': 'Recorded Linux source workloads; archive verification and recalculation only. No new benchmark, universal editor ranking or installer/platform certification.',
    }


if __name__ == '__main__':
    print(json.dumps(verify(Path(__file__).resolve().parents[2]), indent=2))
