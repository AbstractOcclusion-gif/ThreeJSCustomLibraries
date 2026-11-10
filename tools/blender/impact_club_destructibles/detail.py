# SPDX-License-Identifier: GPL-3.0-or-later
"""Offline refinement and paired render relief; convex proxies stay unchanged."""
import hashlib
import json
import math

import bpy
from mathutils import Vector
from . import core


def physics_signature(root, meters):
    from .exporter import collider
    records = [(o['icd_uid'], o.get('structure_primary_cell'), o.get('structure_secondary_cell'), collider(o, meters)[0],
                [round(float(v)*meters,8) for v in core.rest_matrix(o).translation]) for o in core.objects(root,'PIECE')]
    return hashlib.sha256(json.dumps(records,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def refine(root, context, cells=24):
    """Cut the existing coarse cells with a second shared Voronoi field."""
    parents=core.objects(root,'PIECE')
    points=[core.rest_matrix(o)@v.co for o in core.objects(root,'INTACT') for v in o.data.vertices]
    bounds=([min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)])
    marker=bpy.data.materials.new('refinement_primary_interior')
    marker.use_nodes=True
    original_seed,original_count=root.icd_settings.seed,root.icd_settings.cell_count
    root.icd_settings.cell_count=cells
    root.icd_settings.seed=original_seed+104729
    result=[]
    try:
        for parent in parents:
            parent['icd_role']='REFINEMENT_SOURCE'
            primary=parent['structure_cell']
            interior=parent.data.attributes.get('structure_interior')
            parent.data.materials.append(marker)
            for face in parent.data.polygons:
                if interior and interior.data[face.index].value:
                    face.material_index=len(parent.data.materials)-1
            children=core.fracture(context,root,sources=[parent],replace=False,preserve_cell_planes=True,seed_bounds=bounds)
            for child in children:
                child['structure_primary_cell']=primary
                child['structure_secondary_cell']=child['structure_cell']
            result.extend(children)
        for parent in parents:
            core.remove_owned(parent)
        core.finish_parts(context,root,result)
        for index,obj in enumerate(core.objects(root,'PIECE')):
            obj['icd_uid']='%s_p%03d'%(root.icd_settings.asset_id,index)
            obj.icd_piece.mode='DYNAMIC'
        root['structure_secondary_cells']=cells
        return result
    except Exception:
        for obj in result:
            core.remove_owned(obj)
        raise
    finally:
        root.icd_settings.seed=original_seed
        root.icd_settings.cell_count=original_count


def cache_topology(root, meters):
    from .structure_parts import topology
    bpy.context.view_layer.update()
    root['structure_flat_topology']=json.dumps(topology(root,meters),separators=(',',':'))
    root['structure_physics_signature']=physics_signature(root,meters)


def add_cut_relief(root, amplitude=.006):
    """Paired patches share exactly the same vertices, winding reversed.

    Displacement fades to zero at patch boundaries and exterior edges. This is
    render detail bounded by amplitude; collision/mass/topology use flat proxies.
    """
    meters=float(root['icd_meters_per_unit'])
    patches={}
    objects=core.objects(root,'PIECE')
    for obj in objects:
        mesh=obj.data
        marker=mesh.attributes.get('structure_interior')
        matrix=core.rest_matrix(obj)
        if not marker:
            continue
        for face in mesh.polygons:
            if not marker.data[face.index].value:
                continue
            points=[matrix@mesh.vertices[i].co*meters for i in face.vertices]
            key=tuple(sorted(tuple(round(float(p[i]),5) for i in range(3)) for p in points))
            patches.setdefault(key,[]).append((obj,face.index,points,face.normal.copy()))
    replacements={o:{} for o in objects}
    paired=0
    coarse_pairs=0
    maximum=0
    for entries in patches.values():
        if len(entries)!=2:
            continue
        first,second=entries
        if first[3].dot(second[3])>-.999:
            continue
        points=first[2]
        normal=(points[1]-points[0]).cross(points[2]-points[0])
        if normal.length<1e-10:
            continue
        normal.normalize()
        axis=max(range(3),key=lambda i:abs(normal[i]))
        if normal[axis]<0:
            normal=-normal
            points=list(reversed(points))
        start=min(range(len(points)),key=lambda i:tuple(round(float(v),5) for v in points[i]))
        points=points[start:]+points[:start]
        centre=sum(points,Vector())/len(points)
        def distance_to_edge(p,a,b):
            edge=b-a
            t=max(0,min(1,(p-a).dot(edge)/max(edge.length_squared,1e-20)))
            return (p-a-edge*t).length
        def displaced(p):
            nonlocal maximum
            fade=min(1,min(distance_to_edge(p,a,b) for a,b in zip(points,points[1:]+points[:1]))/.04)
            # Deterministic in asset coordinates: shared faces get shared relief.
            noise=(math.sin(p.x*31+p.z*17)*math.sin(p.y*27-p.z*23)+.45*math.sin(p.x*63+p.y*41+p.z*37))/1.45
            amount=amplitude*noise*fade
            maximum=max(maximum,abs(amount))
            return p+normal*amount
        triangles=[]
        for a,b in zip(points,points[1:]+points[:1]):
            grid={}
            divisions=2
            for i in range(divisions+1):
                for j in range(divisions+1-i):
                    grid[i,j]=displaced(centre*(1-(i+j)/divisions)+a*(i/divisions)+b*(j/divisions))
            for i in range(divisions):
                for j in range(divisions-i):
                    triangles.append([grid[i,j],grid[i+1,j],grid[i,j+1]])
                    if i+j<divisions-1:
                        triangles.append([grid[i+1,j],grid[i+1,j+1],grid[i,j+1]])
        for obj,index,_,outward in entries:
            inverse=core.rest_matrix(obj).inverted()
            reverse=outward.dot(normal)<0
            replacements[obj][index]=[[inverse@(p/meters) for p in (list(reversed(tri)) if reverse else tri)] for tri in triangles]
        # A single canonical patch is used twice, never independently randomized.
        paired+=1
        coarse_pairs+=int(first[0].get('structure_primary_cell') != second[0].get('structure_primary_cell'))
    if not paired:
        raise ValueError('No matching cut faces found for relief')
    for obj,faces in replacements.items():
        if not faces:
            continue
        old=obj.data
        vertices=[tuple(v.co) for v in old.vertices]
        polygons=[]
        markers=[]
        old_marker=old.attributes['structure_interior']
        for face in old.polygons:
            if face.index not in faces:
                polygons.append(tuple(face.vertices));markers.append(old_marker.data[face.index].value)
            else:
                for triangle in faces[face.index]:
                    index=len(vertices)
                    vertices.extend(tuple(v) for v in triangle)
                    polygons.append((index,index+1,index+2));markers.append(True)
        mesh=bpy.data.meshes.new(old.name+'_relief')
        mesh.from_pydata(vertices,[],polygons)
        for material in old.materials:
            mesh.materials.append(material)
        marker=mesh.attributes.new('structure_interior','BOOLEAN','FACE')
        marker.data.foreach_set('value',markers)
        mesh.shade_flat()
        mesh.update()
        obj.data=mesh
        if old.users==0:
            bpy.data.meshes.remove(old)
    root['structure_relief_m']=amplitude
    root['structure_relief_pairs']=paired
    root['structure_relief_coarse_pairs']=coarse_pairs
    root['structure_relief_maximum_m']=maximum
    return paired
