"""Nonempty wire-format specimen, independent of the retired world partition.
Regenerate with Python 3.11 from the root. Expected digests call the real core.
"""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[4]))
from client.web.tools.make_viewer_data import core_partition_digest, partition_id_bytes
cells=[{'index':i,'seed_x_m':float(-400+(i%8)*100),'seed_y_m':float(-300+(i//8)*100),'crop':{'name':'green' if i%2 else 'olive','hex':'#6E8F4A'},'neighbours':[(i+1)%32,(i+2)%32]} for i in range(32)]
edges=[{'a':min(i,(i+1)%32),'b':max(i,(i+1)%32),'x0':float(i*10),'y0':-400.0,'x1':float(i*10+5),'y1':400.0} for i in range(32)]
fields={'cells':cells,'partition_edges':edges}
manifest={'cells':len(cells),'edges':len(edges),'digest_core':core_partition_digest(fields),'id_agreed':hashlib.sha256(partition_id_bytes(fields)).hexdigest()[:16],'digest_source':'shared.terrain.field_layout.digest_partition via core_partition_digest'}
Path(__file__).with_name('partition.json').write_text(json.dumps({'version':1,'fields':fields,'partition':manifest},indent=2)+'\n')
