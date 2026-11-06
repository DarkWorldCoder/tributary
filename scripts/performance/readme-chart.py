"""Render the published historical report; this does not run a new benchmark.
Optional documentation dependency: Python 3 with matplotlib (not shipped in the app).
"""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[2]
report = json.loads((root / 'docs/performance/editor-working-set.json').read_text())
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'svg.fonttype': 'none', 'svg.hashsalt': 'tributary-editor-results'})
fig, axes = plt.subplots(2, 2, figsize=(12, 6.8), facecolor='#071e2b')
fig.subplots_adjust(top=.79, bottom=.17, left=.10, right=.94, hspace=.78, wspace=.38)
fig.text(.05, .94, 'Less temporary work. Measured separately from RAM.', fontsize=19, weight='bold', color='#edf7ff')
fig.text(.05, .885, '40,000-line TypeScript fixture · Linux x64 · 3 fresh paired repeats per workload', fontsize=11, color='#abc7d8')
cases = [
    ('allocation-40000-local', 'sampledAllocationEstimateBytes', 1024**2, 'Typing · sampled allocation'),
    ('allocation-40000-remote', 'sampledAllocationEstimateBytes', 1024**2, 'Live updates · sampled allocation'),
    ('plain-40000-local', 'workTreePssPeakKiB', 1024, 'Typing · work-only app-tree PSS peak'),
    ('plain-40000-remote', 'workTreePssPeakKiB', 1024, 'Live updates · work-only app-tree PSS peak'),
]
for ax, (key, metric, divisor, title) in zip(axes.flat, cases):
    values = [report['summary'][key][variant][metric] / divisor for variant in ['baseline', 'optimized']]
    ax.set_facecolor('#071e2b')
    ax.barh([1, 0], values, height=.4, color=['#8199aa', '#66b8ed'], zorder=3)
    ax.set_yticks([1, 0], ['Before', 'After'], color='#d7e9f5')
    ax.set_title(title, loc='left', fontsize=12, color='#edf7ff', pad=13)
    ax.set_xlim(0, max(values)*1.28)
    ax.set_ylim(-.5, 1.5)
    ax.tick_params(axis='x', colors='#abc7d8', labelsize=9)
    ax.tick_params(axis='y', length=0)
    ax.set_xlabel('MiB · zero-based scale', color='#abc7d8', fontsize=9)
    ax.grid(axis='x', color='#244354', linewidth=.6, zorder=0)
    for spine in ax.spines.values(): spine.set_visible(False)
    for y, value in zip([1, 0], values): ax.text(value+max(values)*.025, y, f'{value:.2f}', va='center', color='#edf7ff', fontsize=11)
fig.text(.05, .075, 'Historical ea94d4b → d03db47 · Allocation and ordinary PSS use separate app cohorts.', fontsize=10, color='#abc7d8')
fig.text(.05, .035, 'Small-file RAM and GC-tail latency are mixed. Full method, raw pairs and limitations: BENCHMARKS.md', fontsize=9, color='#abc7d8')
output = root / 'docs/media/editor-benchmarks.svg'
fig.savefig(output, metadata={'Date': None, 'Title': 'Tributary historical editor allocation and PSS comparison', 'Description': 'Zero-based bars derived from docs/performance/editor-working-set.json. Separate cohorts; not a cross-editor or current-release benchmark.'})
output.write_text('\n'.join(line.rstrip() for line in output.read_text().splitlines())+'\n')
if len(sys.argv) == 3 and sys.argv[1] == '--preview':
    fig.savefig(sys.argv[2], dpi=140)
print(output)
