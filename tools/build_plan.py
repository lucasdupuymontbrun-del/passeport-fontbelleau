# Génère le plan de repérage SVG (coupe horizontale à +7,00 m) à partir de model/a2.json et model/a2.bin.
# Usage : depuis la racine du site : python tools/build_plan.py
import re
import json, numpy as np
man=json.load(open('model/a2.json')); g=np.fromfile('model/a2.bin',dtype='<i2')
def tris(name):
    grp=[x for x in man['groups'] if x['name']==name][0]
    return grp, g[grp['byteOffset']//2:(grp['byteOffset']+grp['byteLength'])//2].reshape(-1,3,3).astype(float)/100.0
def cut(T, z):
    segs=[]
    for t in T:
        zs=t[:,2]-z
        if zs.min()>=0 or zs.max()<=0: continue
        pts=[]
        for a,b in ((0,1),(1,2),(2,0)):
            if (zs[a]>0)!=(zs[b]>0):
                k=zs[a]/(zs[a]-zs[b]); p=t[a]+(t[b]-t[a])*k; pts.append(p[:2])
        if len(pts)==2: segs.append(pts)
    return segs
Z=7.0
layers={}
for name in ['a2_walls','a2_frame','a2_stairs','a2_openings','target']:
    grp,T=tris(name)
    layers[name]=(grp,T,cut(T,Z))
grpF,TF=tris('a2_floors'); slab=cut(TF,5.45)
# labels for walls near target
gt,Tt,_=layers['target']
tc=Tt.reshape(-1,3)[:,:2].mean(0)
labels=[]
for name in ['a2_walls','a2_stairs']:
    grp,T,_=layers[name]
    for e in grp['elements']:
        if not (e['z0']/100<Z<e['z1']/100): continue
        sub=T[e['s']:e['s']+e['n']]
        c=sub.reshape(-1,3)[:,:2].mean(0)
        if np.linalg.norm(c-tc)<4.2 and e.get('i') and (re.match(r'A2 PM 10[1-8]$', e['i']) or 'ESC' in e['i']):
            labels.append((e['i'],c))
print('labels',[(l[0],l[1].round(2).tolist()) for l in labels])
# SVG
R=16.5; S=30  # px per m
W=2*R*S
def P(p): return (round((p[0]+R)*S,1), round((R-p[1])*S,1))
def path(segs):
    return ' '.join('M%s,%s L%s,%s'%(*P(a),*P(b)) for a,b in segs)
# target footprint hull
pts=Tt.reshape(-1,3)[:,:2]
from math import atan2
def hull(points):
    pts=sorted(set(map(tuple,np.round(points,3))))
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo=[];up=[]
    for p in pts:
        while len(lo)>=2 and cross(lo[-2],lo[-1],p)<=0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up)>=2 and cross(up[-2],up[-1],p)<=0: up.pop()
        up.append(p)
    return lo[:-1]+up[:-1]
H=hull(pts)
poly=' '.join('%s,%s'%P(p) for p in H)
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {W:.0f}" role="img" aria-labelledby="t d">',
'<title id="t">Repérage de A2 PM 106 — coupe horizontale à l\'étage R+1 de la tour A2</title>',
'<desc id="d">Plan généré depuis la maquette Revit : coupe à +7,00 m (44,89 NGF). Le voile A2 PM 106 est surligné dans le noyau central.</desc>',
f'<path d="{path(slab)}" class="pl-slab"/>',
f'<path d="{path(layers["a2_openings"][2])}" class="pl-open"/>',
f'<path d="{path(layers["a2_walls"][2])}" class="pl-wall"/>',
f'<path d="{path(layers["a2_frame"][2])}" class="pl-wall"/>',
f'<path d="{path(layers["a2_stairs"][2])}" class="pl-stair"/>',
f'<polygon points="{poly}" class="pl-target"/>',
f'<path d="{path(layers["target"][2])}" class="pl-target-edge"/>']
for name,c in labels:
    if 'PM 106' in name: continue
    x,y=P(c); lab=name.replace('A2 ',''); lab='Escalier' if 'ESC' in lab else lab; svg.append(f'<text x="{x}" y="{y}" class="pl-lab">{lab}</text>')
x,y=P(tc); svg.append(f'<circle cx="{x}" cy="{y}" r="34" class="pl-ring"/>')
svg.append(f'<text x="{x}" y="{y-42}" text-anchor="middle" class="pl-tlab">A2 PM 106</text>')
# north arrow (project north = +y, true north angle 0)
svg.append(f'<g class="pl-north" transform="translate({W-60},70)"><path d="M0,-34 L12,12 L0,4 L-12,12 Z"/><text y="34" text-anchor="middle">N</text></g>')
# scale bar 5 m
svg.append(f'<g class="pl-scale" transform="translate(40,{W-40})"><path d="M0,0 H{5*S} M0,-6 V6 M{5*S},-6 V6"/><text x="{2.5*S}" y="-12" text-anchor="middle">5 m</text></g>')
svg.append('</svg>')
open('plans/A2-PM106-R1.svg','w').write('\n'.join(svg))
print('svg bytes', len('\n'.join(svg)), 'segs', {k:len(v[2]) for k,v in layers.items()}, 'slab', len(slab))
