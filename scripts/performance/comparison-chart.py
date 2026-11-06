"""Render the completed cross-editor report. No benchmark runs here."""
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root = Path(__file__).resolve().parents[2]
report = json.loads((root / 'docs/performance/editor-comparison.json').read_text())
assert report['complete'] and all(row['passed'] for row in report['runs'])
apps = ['tributary', 'code', 'zed']
labels = ['Tributary', 'VS Code', 'Zed']
counts = [sum(row['app'] == app for row in report['runs']) for app in apps]
assert len(set(counts)) == 1 and counts[0] > 0
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'svg.fonttype': 'none', 'svg.hashsalt': 'tributary-cross-editor-navigation'})
fig, axes = plt.subplots(1, 3, figsize=(13, 5), facecolor='#071e2b')
fig.subplots_adjust(top=.71, bottom=.26, left=.10, right=.96, wspace=.55)
fig.text(.04, .93, f'Three editors. One generated project with {report["fixture"]["indexedSourceFiles"]:,} source files.', color='#edf7ff', fontsize=20, weight='bold')
fig.text(.04, .86, 'Controlled Linux/Xvfb navigation workflows · software graphics · includes verification overhead', color='#abc7d8', fontsize=11)
for ax, (metric, divisor, title, unit) in zip(axes, [
    ('quickOpenMedianMs',1000,'File open + verified source','Seconds'),
    ('largeFileOpenMedianMs',1000,'Large file + verified EOF','Seconds'),
    ('settledPssMedianMiB',1,'Post-work app-tree memory','MiB PSS'),
]):
    values = [report['summary'][app][metric]/divisor for app in apps]
    ax.set_facecolor('#071e2b'); ax.barh([2,1,0],values,height=.43,color='#66b8ed',zorder=3)
    ax.set_yticks([2,1,0],labels,color='#d7e9f5'); ax.tick_params(axis='y',length=0)
    ax.set_title(title,loc='left',color='#edf7ff',fontsize=11,pad=14)
    ax.set_xlim(0,max(values)*1.38);ax.set_ylim(-.6,2.6);ax.set_xlabel(unit+' · zero-based',color='#abc7d8',fontsize=9)
    ax.tick_params(axis='x',colors='#abc7d8',labelsize=9);ax.grid(axis='x',color='#244354',linewidth=.6,zorder=0)
    for spine in ax.spines.values():spine.set_visible(False)
    for y,value in zip([2,1,0],values):ax.text(value+max(values)*.03,y,f'{value:.2f}' if divisor>1 else f'{value:.0f}',va='center',color='#edf7ff',fontsize=10)
fig.text(.04,.13,f'{counts[0]} fresh apps per editor · order rotated · full per-run observations and settings in BENCHMARKS.md',color='#abc7d8',fontsize=10)
fig.text(.04,.07,'Zed uses emulated Vulkan here. These are not hardware-GPU rankings or exact input-to-paint timings.',color='#abc7d8',fontsize=10)
output=root/'docs/media/editor-comparison.svg'
fig.savefig(output,metadata={'Date':None,'Title':'Controlled cross-editor navigation workload','Description':'Software-graphics headless workflow measurements with clipboard/image verification overhead. Not a general editor ranking.'})
output.write_text('\n'.join(line.rstrip() for line in output.read_text().splitlines())+'\n')
if len(sys.argv)==3 and sys.argv[1]=='--preview':fig.savefig(sys.argv[2],dpi=140)
print(output)
