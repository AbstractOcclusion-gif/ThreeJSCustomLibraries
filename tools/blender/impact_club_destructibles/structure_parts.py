# SPDX-License-Identifier: GPL-3.0-or-later
"""Profile-driven structure authoring on top of the existing addon primitives.

Canonical profiles live in src/destruction/material-profiles.json. An installed
addon can point ICD_MATERIAL_PROFILES to that same file (no second preset table).
"""
import hashlib
import json
import math
import os
from pathlib import Path
import random

import bpy
import bmesh
from mathutils import Matrix, Vector

from . import core


def profiles():
    repository = Path(__file__).resolve().parents[3] / 'src/destruction/material-profiles.json'
    fallback = Path(__file__).resolve().parent / 'data/material-profiles.json'
    path = Path(os.environ.get('ICD_MATERIAL_PROFILES', repository if repository.is_file() else fallback))
    if not path.is_file():
        raise ValueError('Set ICD_MATERIAL_PROFILES to the shared material-profiles.json')
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def tag(root, type_id, material_id, variant=0, seed=1, grain=(1, 0, 0)):
    data, revision = profiles()
    profile = data['materials'][material_id]
    root['structure_part'] = json.dumps({'type': type_id, 'materialId': material_id, 'variant': variant, 'seed': seed,
                                        'grainAxis': list(grain) if material_id == 'oak' else None})
    root['structure_profile_revision'] = revision
    root['structure_type'], root['material_id'] = type_id, material_id
    root.icd_settings.structure_mode = True
    root.icd_settings.structure_type = type_id
    root.icd_settings.structure_material = material_id if material_id in ('brick','stone_rubble','stone_dressed','oak','glass','clay_tile') else 'stone_rubble'
    root.icd_settings.structure_variant = variant
    root.icd_settings.structure_grain = 'XYZ'[max(range(3), key=lambda i: abs(grain[i]))]
    root.icd_settings.seed = seed
    root.icd_settings.cell_count = max(2, profile['fracture']['chunks'])
    root.icd_settings.body_budget = 64
    root.icd_settings.collider_style = 'HULL'
    root.icd_settings.friction = profile['friction']
    root.icd_settings.restitution = profile['restitution']
    root.icd_settings.fx_profile = profile['debris']
    return profile


def planar(context, root, count):
    """Bisect/cap copied intact volumes. No runtime cutting."""
    created = []
    try:
        for source in core.objects(root, 'INTACT'):
            operand = core.evaluated_copy(context, source, root.users_collection[0], root)
            interior = bpy.data.materials.new('planar_interior')
            operand.data.materials.append(interior)
            cap_index = len(operand.data.materials) - 1
            core.recenter(operand)
            context.view_layer.update()
            points = [operand.matrix_local @ v.co for v in operand.data.vertices]
            lo = Vector([min(p[i] for p in points) for i in range(3)])
            hi = Vector([max(p[i] for p in points) for i in range(3)])
            axis = max(range(3), key=lambda i: hi[i] - lo[i])
            normal = Vector([int(i == axis) for i in range(3)])
            for index in range(count):
                mesh = operand.data.copy()
                mesh.transform(operand.matrix_local)
                obj = bpy.data.objects.new('planar_%03d' % index, mesh)
                root.users_collection[0].objects.link(obj)
                obj.parent = root
                created.append(obj)
                bm = bmesh.new()
                try:
                    bm.from_mesh(mesh)
                    for boundary, clear_outer in [(index, False), (index + 1, True)]:
                        if boundary in (0, count):
                            continue
                        point = lo + (hi - lo) * (boundary / count)
                        result = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                            plane_co=point, plane_no=normal, dist=1e-6, clear_inner=not clear_outer, clear_outer=clear_outer)
                        edges = [e for e in result['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
                        if edges:
                            caps = bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
                            for face in caps:
                                face.material_index = cap_index
                    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
                    bm.to_mesh(mesh)
                finally:
                    bm.free()
                if not mesh.polygons:
                    core.remove_owned(obj)
                    created.pop()
            core.remove_owned(operand)
        core.prepare_parts(root)
        core.finish_parts(context, root, created)
        return created
    except Exception:
        for obj in created:
            core.remove_owned(obj)
        raise


def radial_polygons(outer, sectors, rings, centre=None, jitter=0, seed=0, irregular=False):
    """Shared authored sector/ring pattern for glass and cosmetic sheet skins."""
    outer=list(outer)
    cx,cy=centre if centre is not None else (sum(p[0] for p in outer)/len(outer),sum(p[1] for p in outer)/len(outer))
    while len(outer)<sectors:
        index=max(range(len(outer)),key=lambda i:sum((outer[i][k]-outer[(i+1)%len(outer)][k])**2 for k in range(2)))
        a,b=outer[index],outer[(index+1)%len(outer)]
        outer.insert(index+1,tuple((a[k]+b[k])/2 for k in range(2)))
    rng=random.Random(seed)
    phases=[rng.uniform(-math.pi,math.pi) for _ in outer] if irregular else []
    levels=[]
    for ring in range(rings+1):
        level=[]
        for index,p in enumerate(outer):
            t=ring+(rng.uniform(-jitter,jitter) if 0<ring<rings else 0)
            dx,dy=p[0]-cx,p[1]-cy
            if irregular and 0<ring<rings:
                # Shared vertices bend the same seam on both fitted neighbours.
                phase=phases[index]
                t+=.35*math.sin(phase+ring*.7)*math.sin(math.pi*ring/rings)
                angle=.055*math.sin(phase+ring*1.1)*math.sin(math.pi*ring/rings)
                dx,dy=dx*math.cos(angle)-dy*math.sin(angle),dx*math.sin(angle)+dy*math.cos(angle)
            level.append((cx+dx*t/rings,cy+dy*t/rings))
        levels.append(level)
    # Shared ring vertices keep neighbouring shards fitted exactly.
    for index,a in enumerate(outer):
        j=(index+1)%len(outer)
        for ring in range(rings):
            ia,ib=levels[ring][index],levels[ring][j]
            oa,ob=levels[ring+1][index],levels[ring+1][j]
            yield [(cx,cy),oa,ob] if ring==0 else [ia,oa,ob,ib]


def radial(context, root):
    data, _ = profiles()
    settings = data['materials'][json.loads(root['structure_part'])['materialId']]['fracture']
    sectors, rings = settings['sectors'], settings['rings']
    if not (4 <= sectors <= 32 and 1 <= rings <= 8 and sectors*rings <= root.icd_settings.body_budget):
        raise ValueError('Radial sector/ring count exceeds the chunk budget')
    sources = core.objects(root, 'INTACT')
    if len(sources) != 1 or not core.is_closed(sources[0].data):
        raise ValueError('Radial glass expects one closed pane volume')
    scratch = bpy.data.collections.new('ICD_radial_work')
    context.scene.collection.children.link(scratch)
    result = []
    try:
        operand = core.evaluated_copy(context, sources[0], scratch, root)
        operand.parent = None
        context.view_layer.update()
        points = [operand.matrix_world @ v.co for v in operand.data.vertices]
        lo = [min(p[i] for p in points) for i in range(3)]
        hi = [max(p[i] for p in points) for i in range(3)]
        thin = min(range(3), key=lambda i: hi[i]-lo[i])
        axes = [i for i in range(3) if i != thin]
        x0,y0 = [lo[i] for i in axes]
        x1,y1 = [hi[i] for i in axes]
        cx,cy = (x0+x1)/2,(y0+y1)/2
        outer = [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
        interior = bpy.data.materials.new('glass_cut_interior')
        operand.data.materials.append(interior)
        cells = []
        for polygon in radial_polygons(outer,sectors,rings):
                count = len(polygon)
                vertices = []
                for depth in (lo[thin],hi[thin]):
                    for x,y in polygon:
                        point = [0,0,0]
                        point[thin],point[axes[0]],point[axes[1]] = depth,x,y
                        vertices.append(point)
                faces = [tuple(reversed(range(count))),tuple(range(count,2*count))]
                faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
                mesh = bpy.data.meshes.new('radial_cell')
                mesh.from_pydata(vertices,[],faces)
                for material in operand.data.materials:
                    mesh.materials.append(material)
                for face in mesh.polygons:
                    face.material_index = len(mesh.materials)-1
                bm = bmesh.new()
                bm.from_mesh(mesh)
                bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
                bm.to_mesh(mesh)
                bm.free()
                cell = bpy.data.objects.new('radial_cell',mesh)
                scratch.objects.link(cell)
                cells.append(cell)
        context.view_layer.update()
        result = core.fracture_cell_setup.cell_fracture_boolean(context,scratch,operand,cells,remove_doubles=False)
        for obj in result:
            scratch.objects.unlink(obj)
            root.users_collection[0].objects.link(obj)
            obj.parent = root
            obj.matrix_local = Matrix.Identity(4)
        core.prepare_parts(root)
        core.finish_parts(context,root,result)
        return result
    finally:
        for obj in list(scratch.objects):
            core.remove_owned(obj)
        bpy.data.collections.remove(scratch)


def build(context, root):
    if root.icd_settings.structure_material == 'brick' or root.icd_settings.structure_material == 'stone_dressed' and root.icd_settings.masonry_courses or root.icd_settings.structure_material == 'stone_rubble' and root.icd_settings.masonry_fieldstones:
        from . import masonry
        return masonry.build(context, root)
    part = json.loads(root['structure_part'])
    data, _ = profiles()
    profile = data['materials'][part['materialId']]
    method = profile['fracture']['method']
    if profile['response'] == 'crackHinge':
        raise ValueError('RC crack hinges belong to the RC batch; not implemented')
    if method in ('voronoi', 'grain_voronoi'):
        scale = [1, 1, 1]
        if method == 'grain_voronoi':
            # Backend cell_scale weights the bisector normals. Reducing the
            # grain component lengthens cells along that axis.
            grain = part['grainAxis']
            blender_grain = (grain[0], -grain[2], grain[1])
            axis = max(range(3), key=lambda i: abs(blender_grain[i]))
            scale[axis] = 1 / profile['fracture']['stretch']
        sources = core.objects(root, 'INTACT')
        if len(sources) == 1:
            pieces = core.fracture(context, root, preserve_cell_planes=True, cell_scale=scale)
        else:
            # Keep opening/corner subvolumes convex; never hull across their voids.
            previous = core.objects(root, 'PIECE')
            pieces = []
            try:
                old_count = root.icd_settings.cell_count
                shared = root.get('structure_shared_cells', False)
                global_points = [core.rest_matrix(o) @ v.co for o in sources for v in o.data.vertices]
                bounds = ([min(p[i] for p in global_points) for i in range(3)], [max(p[i] for p in global_points) for i in range(3)]) if shared else None
                root.icd_settings.cell_count = old_count if shared else max(2, old_count // len(sources))
                for source in sources:
                    pieces.extend(core.fracture(context, root, preserve_cell_planes=True, cell_scale=scale, sources=[source], replace=False, seed_bounds=bounds))
                for obj in previous:
                    core.remove_owned(obj)
                core.finish_parts(context, root, pieces)
            except Exception:
                for obj in pieces:
                    core.remove_owned(obj)
                raise
            finally:
                root.icd_settings.cell_count = old_count
    elif method == 'planar':
        pieces = planar(context, root, profile['fracture']['chunks'])
    elif method == 'radial' and not root.get('structure_radial_sources'):
        pieces = radial(context, root)
    elif method in ('objects', 'radial', 'none'):
        # Radial sources are explicitly constructed sectors/rings by the generator.
        pieces = core.separate_parts(context, root, islands=False)
    else:
        raise ValueError('Fracture method %s belongs to a later batch' % method)
    for index, piece in enumerate(pieces):
        piece['icd_uid'] = '%s_p%03d' % (root.icd_settings.asset_id, index)
        piece.icd_piece.mode = 'DYNAMIC'
    # A successful explicit switch back to the legacy authoring method must
    # not leave unit metadata referring to the now-replaced masonry pieces.
    for key in ('masonry_units','masonry_bonds','masonry_signature'):
        if key in root:del root[key]
    for generator in core.objects(root,'GENERATOR'):core.remove_owned(generator)
    return pieces


def atlas_image(path):
    """Deterministic padded colour atlas; replace tiles with art without changing UVs."""
    data, _ = profiles()
    spec = data['atlas']
    tile, pad = spec['tilePixels'], spec['paddingPixels']
    width, height = tile * spec['columns'], tile * spec['rows']
    image = bpy.data.images.get('structure_atlas') or bpy.data.images.new('structure_atlas', width, height)
    image.colorspace_settings.name = 'sRGB'
    rows = {p['atlas']['row']: (key, p) for key, p in data['materials'].items()}
    pixels = []
    for y in range(height):
        row, ty = divmod(y, tile)
        for x in range(width):
            column, tx = divmod(x, tile)
            key, profile = rows.get(row, ('reserved', {'atlas': {'surface': [.5]*3, 'interior': [.5]*3}}))
            # Clamp the border to its adjacent texel, rather than painting a dark gutter.
            u, v = max(pad, min(tile-pad-1, tx)), max(pad, min(tile-pad-1, ty))
            noise = ((u*73856093 ^ v*19349663 ^ row*83492791) & 255) / 255 - .5
            detail = math.sin(u*.28 + math.sin(v*.04)*2)*.06 if key == 'oak' else noise*.09
            color = profile['atlas']['surface' if column == 0 else 'interior']
            pixels.extend([max(0, min(1, c + detail)) for c in color] + [1])
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(Path(path).resolve())
    image.file_format = 'PNG'
    image.save()
    return image


def assign_uvs(root, image):
    data, _ = profiles()
    part = json.loads(root['structure_part'])
    profile = data['materials'][part['materialId']]
    atlas = data['atlas']
    name = 'structure_glass' if part['materialId'] == 'glass' else 'structure_opaque'
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .85
    texture = material.node_tree.nodes.get('Structure Atlas')
    if not texture:
        texture = material.node_tree.nodes.new('ShaderNodeTexImage')
        texture.name = 'Structure Atlas'
        material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    texture.image = image
    texture.extension = 'EXTEND'
    if part['materialId'] == 'glass':
        shader.inputs['Transmission Weight'].default_value = 1
        shader.inputs['IOR'].default_value = 1.5
        shader.inputs['Roughness'].default_value = .15
    all_objects = core.objects(root, 'INTACT') + core.objects(root, 'PIECE')
    coordinates = [core.rest_matrix(o) @ v.co for o in core.objects(root, 'INTACT') for v in o.data.vertices]
    lo = [min(p[i] for p in coordinates) for i in range(3)]
    span = [max(p[i] for p in coordinates) - lo[i] for i in range(3)]
    inset = (atlas['paddingPixels'] + .5) / atlas['tilePixels']
    for obj in all_objects:
        mesh = obj.data
        mesh.shade_flat()
        if part['materialId']=='stone_rubble' and root.icd_settings.masonry_fieldstones and obj.get('icd_role')=='PIECE' and not obj.get('masonry_lintel'):
            mesh.shade_smooth()
        if mesh.has_custom_normals:
            mesh.normals_split_custom_set([(0, 0, 0)] * len(mesh.loops))
        previous_marker = mesh.attributes.get('structure_interior')
        interior = [bool((previous_marker and previous_marker.data[p.index].value) or (p.material_index < len(mesh.materials) and mesh.materials[p.material_index] and '_interior' in mesh.materials[p.material_index].name)) for p in mesh.polygons]
        marker = mesh.attributes.get('structure_interior') or mesh.attributes.new('structure_interior', 'BOOLEAN', 'FACE')
        uv = mesh.uv_layers.active or mesh.uv_layers.new(name='UVMap')
        transform = core.rest_matrix(obj)
        for polygon, cut in zip(mesh.polygons, interior):
            marker.data[polygon.index].value = cut
            normal = transform.to_3x3().inverted().transposed() @ polygon.normal
            axis = max(range(3), key=lambda i: abs(normal[i]))
            axes = [i for i in range(3) if i != axis]
            for loop in polygon.loop_indices:
                point = transform @ mesh.vertices[mesh.loops[loop].vertex_index].co
                u, v = [(point[i] - lo[i]) / max(span[i], 1e-8) for i in axes]
                u, v = [inset + max(0, min(1, t)) * (1 - 2*inset) for t in (u, v)]
                uv.data[loop].uv = ((int(cut) + u)/atlas['columns'], (profile['atlas']['row'] + v)/atlas['rows'])
            polygon.material_index = 0
        mesh.materials.clear()
        mesh.materials.append(material)


def clip_polygon(subject, clip):
    def cross(a, b, p):
        return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(clip, clip[1:]+clip[:1]))
    if area < 0:
        clip = list(reversed(clip))
    for a, b in zip(clip, clip[1:]+clip[:1]):
        incoming, subject = subject, []
        if not incoming:
            break
        prev = incoming[-1]
        dprev = cross(a, b, prev)
        for point in incoming:
            d = cross(a, b, point)
            if (d >= -1e-9) != (dprev >= -1e-9):
                t = dprev/(dprev-d)
                subject.append(tuple(prev[i]+t*(point[i]-prev[i]) for i in range(2)))
            if d >= -1e-9:
                subject.append(point)
            prev, dprev = point, d
    return subject


def topology(root, meters):
    """Shared cut area from actual mesh triangles, not enclosing collision boxes."""
    faces = {}
    for obj in core.objects(root, 'PIECE'):
        mesh = obj.data
        mesh.calc_loop_triangles()
        transform = core.rest_matrix(obj)
        points = [transform @ v.co * meters for v in mesh.vertices]
        triangles = []
        for triangle in mesh.loop_triangles:
            p = [points[i] for i in triangle.vertices]
            n = (p[1]-p[0]).cross(p[2]-p[0])
            if n.length > 1e-12:
                n.normalize()
                triangles.append((p, n))
        faces[obj['icd_uid']] = triangles
    all_points = [p for triangles in faces.values() for triangle,normal in triangles for p in triangle]
    span = max(max(p[i] for p in all_points)-min(p[i] for p in all_points) for i in range(3))
    # Float-rounded edge contacts are not load-bearing faces. Their apparent
    # area scales with the asset size and float precision, not material strength.
    area_epsilon = max(1e-8, span*span*1e-6)
    bonds = []
    items = list(faces.items())
    for i, (aid, afaces) in enumerate(items):
        for bid, bfaces in items[i+1:]:
            area, weighted, normal_sum = 0, Vector(), Vector()
            for ap, an in afaces:
                axis = max(range(3), key=lambda k: abs(an[k]))
                axes = [k for k in range(3) if k != axis]
                for bp, bn in bfaces:
                    if an.dot(bn) > -.99999 or max(abs(an.dot(p-ap[0])) for p in bp) > 2e-6:
                        continue
                    poly = clip_polygon([tuple(p[k] for k in axes) for p in ap], [tuple(p[k] for k in axes) for p in bp])
                    if len(poly) < 3:
                        continue
                    for j in range(1, len(poly)-1):
                        tri = [poly[0], poly[j], poly[j+1]]
                        amount = abs((tri[1][0]-tri[0][0])*(tri[2][1]-tri[0][1])-(tri[1][1]-tri[0][1])*(tri[2][0]-tri[0][0]))*.5/abs(an[axis])
                        if amount < 1e-10:
                            continue
                        centre = Vector()
                        for k, ax in enumerate(axes):
                            centre[ax] = sum(p[k] for p in tri)/3
                        centre[axis] = (an.dot(ap[0])-sum(an[k]*centre[k] for k in axes))/an[axis]
                        area += amount
                        weighted += centre*amount
                        normal_sum += an*amount
            if area > area_epsilon:
                if normal_sum.length < 1e-10:
                    raise ValueError('Ambiguous contact normal: split this authored region')
                normal_sum.normalize()
                # Y-up conversion matches exporter.AXIS.
                convert = lambda p: [p.x, p.z, -p.y]
                bonds.append({'id': 'bond_%03d' % len(bonds), 'a': aid, 'b': bid, 'position': convert(weighted/area),
                              'normal': convert(normal_sum), 'areaM2': area, 'kind': 'cohesive'})
    return bonds


def metadata(root, meters, volumes):
    if 'masonry_units' in root:
        from . import masonry
        return masonry.metadata(root, meters, volumes)
    data, revision = profiles()
    part = json.loads(root['structure_part'])
    if revision != root['structure_profile_revision']:
        raise ValueError('Profiles changed since authoring; rebuild this part')
    profile = data['materials'][part['materialId']]
    points = [core.rest_matrix(o) @ v.co * meters for o in core.objects(root, 'INTACT') for v in o.data.vertices]
    size = [max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]
    part['sizeM'] = [round(size[0], 6), round(size[2], 6), round(size[1], 6)]
    root['structure_size_m'] = part['sizeM']
    pieces = core.objects(root, 'PIECE')
    if any(p.icd_piece.mode == 'COSMETIC' for p in pieces):
        raise ValueError('V2 farmhouse parts use physical chunks; fine debris is emitted by the existing FX')
    for obj in pieces:
        proxies = [p for p in obj.children if p.get('icd_role') == 'COLLIDER']
        if any(p.get('icd_proxy_kind') == 'BOX_FALLBACK' for p in proxies):
            raise ValueError('Structure parts cannot use a hull fallback')
        if abs(obj.icd_piece.mass_weight - 1) > 1e-6:
            raise ValueError('Structure mass comes from profile density; reset the mass multiplier to 1')
        if not obj.data.uv_layers.active:
            raise ValueError('Assign atlas UVs before export')
        coords = [core.rest_matrix(obj) @ v.co * meters for v in obj.data.vertices]
        if not root.get('structure_shared_cells') and min(max(p[i] for p in coords)-min(p[i] for p in coords) for i in range(3)) < profile['fracture']['minChunkM'] - 1e-6:
            raise ValueError('Chunk below material minimum size: ' + obj.name)
    if root.get('structure_secondary_cells'):
        part['detail'] = {'secondaryCells': int(root['structure_secondary_cells']), 'cutReliefM': float(root.get('structure_relief_m',0))}
    if 'structure_flat_topology' in root:
        from .detail import physics_signature
        if physics_signature(root, meters) != root['structure_physics_signature']:
            raise ValueError('Physics changed after relief authoring; rebuild the detail asset')
        bonds = json.loads(root['structure_flat_topology'])
    else:
        bonds = topology(root, meters)
    if root.get('structure_secondary_cells'):
        primary = {p['icd_uid']: p['structure_primary_cell'] for p in pieces}
        secondary = {p['icd_uid']: p['structure_secondary_cell'] for p in pieces}
        for bond in bonds:
            if primary[bond['a']] != primary[bond['b']]:
                bond['breakable'], bond['fractureLevel'] = True, 1
            elif secondary[bond['a']] != secondary[bond['b']]:
                bond['breakable'], bond['fractureLevel'] = True, 2
            else:
                bond['breakable'] = False
    elif root.get('structure_shared_cells'):
        cells = {p['icd_uid']: p['structure_cell'] for p in pieces}
        for bond in bonds:
            bond['breakable'] = cells[bond['a']] != cells[bond['b']]
    minimum_area = profile['fracture']['minChunkM'] ** 2
    if not root.get('structure_secondary_cells') and any(b['areaM2'] < minimum_area for b in bonds if b.get('breakable', True)):
        raise ValueError('Bond face below material minimum size; change fracture seed')
    if root.get('structure_secondary_cells'):
        # Construction atoms are never released individually. Check the actual
        # finest releasable components rather than their clipped atom slivers.
        leaves = {p['icd_uid']: p['icd_uid'] for p in pieces}
        def leaf(a):
            while leaves[a] != a:
                a = leaves[a]
            return a
        for bond in bonds:
            if not bond.get('breakable', True):
                leaves[leaf(bond['a'])] = leaf(bond['b'])
        coordinates = {}
        for obj in pieces:
            coordinates[obj['icd_uid']] = [core.rest_matrix(obj) @ v.co * meters for v in obj.data.vertices]
        while True:
            groups = {}
            for pid, points in coordinates.items():
                groups.setdefault(leaf(pid), []).extend(points)
            small = next((gid for gid, points in groups.items() if min(max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)) < profile['fracture']['minChunkM'] - 1e-6), None)
            if small is None:
                break
            neighbours = [b for b in bonds if b.get('breakable', True) and b.get('fractureLevel') == 2 and leaf(b['a']) != leaf(b['b']) and small in (leaf(b['a']), leaf(b['b']))]
            if not neighbours:
                raise ValueError('Secondary sliver has no same-primary neighbour; change refinement seed')
            bond = max(neighbours, key=lambda b:b['areaM2'])
            # Weld only the necessary fine interface, preserving coarse cracks.
            bond['breakable'] = False
            leaves[leaf(bond['a'])] = leaf(bond['b'])
    parent = {p['icd_uid']: p['icd_uid'] for p in pieces}
    def find(a):
        while parent[a] != a:
            a = parent[a]
        return a
    for bond in bonds:
        parent[find(bond['a'])] = find(bond['b'])
    components = len({find(a) for a in parent})
    expected = root.get('structure_expected_components', 1)
    if components != expected:
        raise ValueError('Expected %d connected components, got %d; inspect fracture' % (expected, components))
    total_volume = sum(volumes.values())
    root.icd_settings.mass = total_volume * profile['densityKgM3']
    root.icd_settings.break_energy = max(.01, sum(b['areaM2'] for b in bonds if b.get('breakable', True) and b.get('fractureLevel',1)==1) * profile['fractureEnergyJPerM2'])
    triangles = sum(len(p.vertices)-2 for obj in pieces for p in obj.data.polygons)
    sockets = []
    for name, axis, maximum in [('left', 0, False), ('right', 0, True), ('bottom', 1, False), ('top', 1, True)]:
        # Select an actual hull extreme, never a point in a door/window opening.
        candidates = []
        for obj in pieces:
            for vertex in obj.data.vertices:
                p = core.rest_matrix(obj) @ vertex.co * meters
                candidates.append((obj['icd_uid'], [p.x, p.z, -p.y]))
        pid, point = (max if maximum else min)(candidates, key=lambda item: item[1][axis])
        direction = [0, 0, 0]
        direction[axis] = 1 if maximum else -1
        sockets.append({'id': name, 'pieceId': pid, 'position': point, 'axis': direction, 'connection': 'bearing'})
    return {'version': 2, 'material': part['materialId'], 'part': part, 'profileRevision': revision, 'bonds': bonds, 'joints': [], 'sockets': sockets,
            'validation': {'physicalChunks': len(pieces), 'collisionHulls': len(pieces), 'renderTriangles': triangles, 'connectedComponents': components, **({'reliefPairs':int(root['structure_relief_pairs'])} if 'structure_relief_pairs' in root else {})}}
