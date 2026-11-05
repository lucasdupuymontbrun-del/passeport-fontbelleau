# Convertit l export Revit (export3d/manifest.json + geometry.bin) en fichiers web model/a2.json et model/a2.bin.
# Usage : depuis la racine du site, avec le dossier export3d copié à côté : python tools/build_model.py puis gzip -9 -k model/a2.bin
import json, numpy as np
man=json.load(open('export3d/manifest.json')); g=np.fromfile('export3d/geometry.bin',dtype='<i2')
out={'version':1,'units':'cm','note':'Maillage extrait de la maquette Revit MQT-FONTBELLEAU-G4 (LOD grossier). Origine : centre de la tour A2. z=0 : 37,89 NGF.','z0_ngf_m':37.89,'groups':[]}
blobs=[];off=0
order=['topo','found','parking','a1','a2_floors','a2_walls','a2_frame','a2_stairs','a2_rail','a2_openings','a2_generic','target']
G={x['name']:x for x in man['groups']}
for name in order:
    grp=G[name]
    a=g[grp['byteOffset']//2:(grp['byteOffset']+grp['byteLength'])//2]
    b=a.astype('<i2').tobytes()
    els=[]
    if name.startswith('a2_') or name=='target':
        for e in grp['elements']:
            lv=(e.get('ws') or '').replace('A2 - ','')
            els.append({'id':e['id'],'i':e.get('ident'),'t':e.get('type'),'c':e.get('cat'),'lv':lv,'s':e['s'],'n':e['n'],'z0':e['z0'],'z1':e['z1']})
    out['groups'].append({'name':name,'byteOffset':off,'byteLength':len(b),'triangles':len(a)//9,'elements':els})
    blobs.append(b); off+=len(b)
open('model/a2.bin','wb').write(b''.join(blobs))
json.dump(out,open('model/a2.json','w'),ensure_ascii=False,separators=(',',':'))
import os
print(os.path.getsize('model/a2.bin'), os.path.getsize('model/a2.json'))
