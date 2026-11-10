# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored brick and coursed-stone units; no runtime geometry cutting."""
import json
import math
import random
import hashlib
import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.geometry import convex_hull_2d
from . import core, structure_parts


def signature(root):
    return hashlib.sha256(json.dumps([(o['icd_uid'],[list(core.rest_matrix(o) @ v.co) for v in o.data.vertices]) for o in core.objects(root,'PIECE')],sort_keys=True).encode()).hexdigest()


def is_stone(settings):
    return settings.structure_material == 'stone_dressed' and settings.masonry_courses or is_fieldstone(settings)


def is_fieldstone(settings):
    return settings.structure_material == 'stone_rubble' and settings.masonry_fieldstones


def outline(obj):
    points=[core.rest_matrix(obj) @ v.co for v in obj.data.vertices]
    points=sorted({(round(p.x,7),round(p.z,7)) for p in points})
    return [list(points[i]) for i in convex_hull_2d([Vector(p) for p in points])]


# Random squared rubble. A nominal stone is STONE_MODULES (long, high) grid steps;
# each stone takes a weighted number of steps, so bed joints break from stone to
# stone instead of running across the wall. MODULE_JITTER varies the step sizes.
STONE_MODULES=(3,2)
STONE_LENGTH_MODULES=((1,.05),(2,.25),(3,.3),(4,.2),(5,.12),(6,.08))
STONE_HEIGHT_MODULES=((1,.3),(2,.45),(3,.25))
MODULE_JITTER=.35


def wall_cells(regions, length, height, seed, irregularity):
    """Random squared rubble: rectangular stones of mixed length and height.

    Each (x0, x1, z0, z1) wall region is tiled on its own jittered step grid,
    bottom-up, so stones never straddle an opening and no slivers are clipped.
    """
    rng=random.Random(seed)
    def steps(start,end,module):
        sizes=[rng.uniform(1-MODULE_JITTER*irregularity,1+MODULE_JITTER*irregularity) for _ in range(max(1,round((end-start)/module)))]
        values=[start]
        for size in sizes[:-1]:values.append(values[-1]+(end-start)*size/sum(sizes))
        return values+[end]
    def pick(table):
        roll=rng.random()*sum(weight for _,weight in table)
        for value,weight in table:
            roll-=weight
            if roll<=0:return value
        return table[-1][0]
    polygons=[]
    for x0,x1,z0,z1 in regions:
        xs,zs=steps(x0,x1,length/STONE_MODULES[0]),steps(z0,z1,height/STONE_MODULES[1])
        columns,rows=len(xs)-1,len(zs)-1
        owner=[[None]*columns for _ in range(rows)];stone=0
        for row in range(rows):
            for column in range(columns):
                if owner[row][column] is not None:continue
                free=0
                while column+free<columns and owner[row][column+free] is None:free+=1
                # Prefer a length whose end does not sit on a vertical joint of the stones below.
                for _ in range(4):
                    wide=min(pick(STONE_LENGTH_MODULES),free);end=column+wide
                    if not (row and end<columns and owner[row-1][end-1]!=owner[row-1][end]):break
                tall=min(pick(STONE_HEIGHT_MODULES),rows-row)
                # Stones lie flat (never taller than long) and stop under stones already placed above.
                while tall>1 and (zs[row+tall]-zs[row]>xs[column+wide]-xs[column] or
                                  any(owner[r][c] is not None for r in range(row+1,row+tall) for c in range(column,column+wide))):tall-=1
                for r in range(row,row+tall):
                    for c in range(column,column+wide):owner[r][c]=stone
                stone+=1
                points=[Vector(q) for q in ((xs[column],zs[row]),(xs[column+wide],zs[row]),(xs[column+wide],zs[row+tall]),(xs[column],zs[row+tall]))]
                polygons.append([tuple(points[i]) for i in convex_hull_2d(points)])
    return polygons


def fieldstone_units(root, sources, low, high):
    """Extruded cells clipped to the source wall regions and openings."""
    s=root.icd_settings
    length,height,_=unit_size(s)
    boxes=[bounds(source) for source in sources if not source.get('masonry_lintel')]
    solid=[bounds(source) for source in sources]
    # A point just past a stone side that is inside the wall but in no source region is an opening.
    def opening(x,z):
        return low[0]<x<high[0] and low[2]<z<high[2] and not any(b[0][0]-1e-5<=x<=b[0][1]+1e-5 and b[2][0]-1e-5<=z<=b[2][1]+1e-5 for b in solid)
    polygons=wall_cells([(box[0][0],box[0][1],box[2][0],box[2][1]) for box in boxes],length,height,s.seed,s.stone_irregularity)
    units=[]
    for source in sources:
        box=bounds(source)
        bm=bmesh.new();bm.from_mesh(source.data)
        volume=abs(bm.calc_volume()*core.rest_matrix(source).to_3x3().determinant());bm.free()
        if abs(volume-math.prod(b-a for a,b in box))>max(1e-8,volume*1e-5):
            raise ValueError('Fieldstones currently require rectangular wall regions; preserve openings as separate jamb/sill/lintel regions')
        if source.get('masonry_lintel'):
            obj=core.evaluated_copy(bpy.context,source,root.users_collection[0],root);obj['masonry_lintel']=True;units.append(obj);continue
        rectangle=[(box[0][0],box[2][0]),(box[0][1],box[2][0]),(box[0][1],box[2][1]),(box[0][0],box[2][1])]
        for polygon in polygons:
            clipped=structure_parts.clip_polygon(polygon,rectangle)
            # Remove duplicate and collinear clipping vertices before bevel/hull.
            if len(clipped)<3:continue
            area=abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(clipped,clipped[1:]+clipped[:1])))/2
            # Stones meet region boundaries exactly; float noise there must not leave paper-thin units.
            if area<1e-6:continue
            bm=bmesh.new()
            rings=[[bm.verts.new((x,y,z)) for x,z in clipped] for y in box[1]]
            for ring in rings:bm.faces.new(ring)
            for i in range(len(clipped)):bm.faces.new((rings[0][i-1],rings[0][i],rings[1][i],rings[1][i-1]))
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
            bmesh.ops.dissolve_limit(bm,angle_limit=.0001,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
            mesh=bpy.data.meshes.new('Fieldstone unit');bm.to_mesh(mesh);bm.free()
            obj=bpy.data.objects.new('fieldstone_unit',mesh);root.users_collection[0].objects.link(obj);obj.parent=root
            xs,zs=[q[0] for q in clipped],[q[1] for q in clipped];mx,mz=(min(xs)+max(xs))/2,(min(zs)+max(zs))/2
            # Sides (x min, x max, z min, z max) facing a door or window stay square, like dressed jamb stones.
            obj['masonry_open_sides']=[opening(min(xs)-.01,mz),opening(max(xs)+.01,mz),opening(mx,min(zs)-.01),opening(mx,max(zs)+.01)]
            units.append(obj)
    return units


def unit_size(settings):
    return settings.stone_size if is_stone(settings) else settings.brick_size


# Share of the face chamfer used to knock the four outline corners off a squared stone.
CORNER_ROUNDING=.3


def round_fieldstone(unit, amount, gap=0):
    """Squared rubble stone: thick convex body with worn faces, shared by render and collision.

    Two full outline rings keep most of the wall depth and recover the mortar
    gap so joints stay closed; an inset ring on each face gives the chamfer.
    The construction outline stays untouched for mortar/support metadata.
    """
    polygon=outline(unit);box=bounds(unit)
    if len(polygon)>10:raise ValueError('Fieldstone outline exceeds the 64-vertex hull budget; change seed or stone size')
    middle=sum(box[1])/2;depth=box[1][1]-box[1][0];chamfer=min(amount,depth*.25)
    centre=Vector((sum(box[0])/2,sum(box[2])/2));half=Vector(((box[0][1]-box[0][0])/2,(box[2][1]-box[2][0])/2))
    # Recover the mortar gap about the unit centre, then build both rings from this one
    # polygon so every chamfer face stays planar for the convex collision hull.
    grown=[Vector(tuple(centre[i]+(q[i]-centre[i])*(1+gap*.45/half[i]) for i in range(2))) for q in polygon]
    if sum(a.x*b.y-b.x*a.y for a,b in zip(grown,grown[1:]+grown[:1]))<0:grown.reverse()
    count=len(grown);inset=min(chamfer+gap*.45,min(half)*.6)
    sides=unit.get('masonry_open_sides') or (False,)*4
    limits=(min(q.x for q in grown),max(q.x for q in grown),min(q.y for q in grown),max(q.y for q in grown))
    def square(a,b):
        return any(flag and abs(a[k//2]-limits[k])<1e-5 and abs(b[k//2]-limits[k])<1e-5 for k,flag in enumerate(sides))
    body=[];lines=[]
    for i,q in enumerate(grown):
        sharp=square(grown[i-1],q) or square(q,grown[(i+1)%count])
        for neighbour in (grown[i-1],grown[(i+1)%count]):
            edge=(neighbour-q).length
            body.append(q.lerp(neighbour,0 if sharp or edge<=1e-9 else min(.3,CORNER_ROUNDING*chamfer/edge)))
        direction=(grown[(i+1)%count]-q).normalized()
        lines.append((q+Vector((-direction.y,direction.x))*(0 if square(q,grown[(i+1)%count]) else inset),direction))
    face=[]
    for i in range(count):
        (a,u),(b,w)=lines[i-1],lines[i];cross=u.x*w.y-u.y*w.x
        face.append(a+u*(((b.x-a.x)*w.y-(b.y-a.y)*w.x)/cross) if abs(cross)>1e-9 else b)
    # Convex hull orders the unordered fillet samples and removes redundant ones.
    bm=bmesh.new();transform=core.rest_matrix(unit).inverted()
    for y in (middle-depth/2+chamfer,middle+depth/2-chamfer):
        for q in body:bm.verts.new(transform @ Vector((q.x,y,q.y)))
    for y in box[1]:
        for q in face:bm.verts.new(transform @ Vector((q.x,y,q.y)))
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
    unused=[v for v in bm.verts if not v.link_faces]
    if unused:bmesh.ops.delete(bm,geom=unused,context='VERTS')
    bmesh.ops.dissolve_limit(bm,angle_limit=.001,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    old=unit.data;mesh=bpy.data.meshes.new('Rounded fieldstone');bm.to_mesh(mesh);bm.free();unit.data=mesh
    if old.users==0:bpy.data.meshes.remove(old)


def course_spans(settings,low,high,row,boundaries):
    length=unit_size(settings)[0]
    if not is_stone(settings):
        offset=(row%2)*length/2
        return [(low+col*length+offset,low+(col+1)*length+offset) for col in range(-1,math.ceil((high-low)/length)+1)]
    rng=random.Random(settings.seed+row*1009)
    variation=settings.stone_length_variation
    minimum=min(.08,length*.2)
    cuts=[low]
    x=low+length*(.5 if row%2 else 1)*rng.uniform(1-variation,1+variation)
    while x<high:
        # Keep the shared course field continuous through opening regions, but
        # avoid nearly coincident cuts at their jambs and exterior boundaries.
        if all(abs(x-b)>=minimum for b in boundaries):cuts.append(x)
        x+=length*rng.uniform(1-variation,1+variation)
    cuts.append(high)
    return list(zip(cuts,cuts[1:]))


# Clear opening width, lintel bearing on each side and lintel height shared by the wall presets (metres).
OPENING_WIDTH=.9
LINTEL_BEARING=.24
LINTEL_HEIGHT=.18
# kind -> (head height, sill height)
OPENING_KINDS={'door':(2.05,0),'window':(2.1,.9)}


def new_wall(context,width=1,height=3,depth=.11,window=False,material='brick',door=False,openings=None):
    """Source regions with a true clear opening and independent bearing lintel."""
    if width<1 or height<2.5 or depth<=0:
        raise ValueError('New-wall preset requires width >= 1 m and height >= 2.5 m')
    def box(name,size,centre):
        bpy.ops.mesh.primitive_cube_add(size=1,location=(centre[0],-centre[2],centre[1]))
        obj=context.object;obj.name=name;obj.dimensions=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return obj
    if window and door:raise ValueError('Choose one opening per wall preset')
    if openings:
        # Several openings as (kind, centre x from the wall middle[, base height]). Openings sharing
        # an x are stacked, one per storey. Each keeps its own bearing lintel; the piers between
        # columns of openings run the full wall height.
        if window or door:raise ValueError('Use either openings or the single window/door preset')
        sources=[];cursor=-width/2;half=OPENING_WIDTH/2
        pier=lambda start,end:box('pier',(end-start,height,depth),((start+end)/2,height/2,0))
        columns={}
        for kind,x,*base in openings:columns.setdefault(round(x,6),[]).append((base[0] if base else 0,kind))
        for x,stack in sorted(columns.items()):
            left,right=x-half-LINTEL_BEARING,x+half+LINTEL_BEARING
            if left<cursor-1e-6 or right>width/2+1e-6:raise ValueError('Opening at %s does not fit the wall or overlaps its neighbour'%x)
            if left-cursor>1e-6:sources.append(pier(cursor,left))
            floor=0
            for base,kind in sorted(stack):
                head,sill=OPENING_KINDS[kind];head+=base;sill+=base
                if base<floor-1e-6 or head+LINTEL_HEIGHT>=height:raise ValueError('Opening at %s, %s does not fit the wall height or overlaps the one below'%(x,base))
                for x0,x1 in ((left,x-half),(x+half,right)):sources.append(box('jamb',(x1-x0,head-floor,depth),((x0+x1)/2,(head+floor)/2,0)))
                if sill-floor>1e-6:sources.append(box('sill',(OPENING_WIDTH,sill-floor,depth),(x,(sill+floor)/2,0)))
                sources.append(box('lintel',(right-left,LINTEL_HEIGHT,depth),(x,head+LINTEL_HEIGHT/2,0)))
                floor=head+LINTEL_HEIGHT
            sources.append(box('above',(right-left,height-floor,depth),(x,(height+floor)/2,0)))
            cursor=right
        if width/2-cursor>1e-6:sources.append(pier(cursor,width/2))
    elif door:
        jamb=(width-.9)/2
        sources=[box('left',(jamb,2.05,depth),(-(.9+jamb)/2,1.025,0)),box('right',(jamb,2.05,depth),((.9+jamb)/2,1.025,0)),
                 box('above',(width,height-2.23,depth),(0,(height+2.23)/2,0)),box('lintel',(width,.18,depth),(0,2.14,0))]
    elif window:
        jamb=(width-.9)/2
        sources=[box('left',(jamb,2.1,depth),(-(.9+jamb)/2,1.05,0)),box('right',(jamb,2.1,depth),((.9+jamb)/2,1.05,0)),
                 box('sill',(.9,.9,depth),(0,.45,0)),box('above',(width,height-2.28,depth),(0,(height+2.28)/2,0)),
                 box('lintel',(width,.18,depth),(0,2.19,0))]
    else:sources=[box('wall',(width,height,depth),(0,height/2,0))]
    core.select_only(context,sources,sources[0]);root=core.create_asset(context);context.view_layer.update()
    points=[core.rest_matrix(o) @ v.co for o in core.objects(root,'INTACT') for v in o.data.vertices]
    centre=Vector([(min(p[k] for p in points)+max(p[k] for p in points))/2 for k in range(3)])
    for intact in core.objects(root,'INTACT'):
        intact.data.transform(Matrix.Translation(-centre) @ core.rest_matrix(intact));intact.matrix_local=Matrix.Identity(4)
    root.location=(0,0,0);context.view_layer.update()
    for intact in core.objects(root,'INTACT'):
        b=bounds(intact)
        if (window or door or openings) and abs(b[2][1]-b[2][0]-LINTEL_HEIGHT)<1e-5:intact['masonry_lintel']=True
    root.icd_settings.structure_material=material;root.icd_settings.structure_mode=True
    root.icd_settings.structure_type='wall.masonry.door' if door else 'wall.masonry.window' if window else 'wall.masonry.solid'
    root.icd_settings.masonry_input='NEW'
    root.icd_settings.brick_size=(.24,.09,depth)
    if material in ('stone_dressed','stone_rubble'):
        root.icd_settings.masonry_courses=material=='stone_dressed'
        root.icd_settings.masonry_fieldstones=material=='stone_rubble'
        root.icd_settings.stone_size=(.45,.25,depth)
        root.icd_settings.cluster_p=1.2
        root.icd_settings.units_per_chunk=8
        root.icd_settings.mortar_gap=.012
        root.icd_settings.border_detail=.08
        if material=='stone_rubble':
            root.icd_settings.stone_size=(.4,.26,depth)
            root.icd_settings.stone_bevel=.045
            root.icd_settings.cluster_p=1.4
            root.icd_settings.units_per_chunk=6
            root.icd_settings.masonry_input='EXISTING'
    return root


def bond_course_ends(context, root, course_height, phase=0):
    """Author complementary corner teeth before the normal unit pipeline.

    Width is the maximum exterior width. Phase 0 runs through on even
    courses; phase 1 runs through on odd courses. Perpendicular walls use
    opposite phases and the same height datum. Existing sources are boxes.
    """
    sources = core.objects(root, 'INTACT')
    boxes = [bounds(o) for o in sources]
    low, high = min(b[0][0] for b in boxes), max(b[0][1] for b in boxes)
    bottom, top = min(b[2][0] for b in boxes), max(b[2][1] for b in boxes)
    depth = max(b[1][1] for b in boxes)-min(b[1][0] for b in boxes)
    if phase not in (0, 1) or course_height <= 0 or high-low <= 2*depth:
        raise ValueError('Invalid bonded course ends')
    regions = []
    for source, box in zip(sources, boxes):
        if len(source.data.vertices)!=8 or any(any(min(abs(p[k]-box[k][end]) for end in (0,1))>1e-6 for k in range(3)) for p in (core.rest_matrix(source) @ v.co for v in source.data.vertices)):
            raise ValueError('Bonded ends require rectangular source regions')
        # Keep a real continuous lintel over the opening, with one unit of
        # bearing on each jamb. Its old full-width wings become normal courses.
        if source.get('masonry_lintel'):
            beam = .9/2+depth
            regions.append((source, [[-beam, beam], box[1], box[2]], True))
            for a,b in ((low,-beam),(beam,high)):
                regions.append((source, [[a,b], box[1], box[2]], False))
        else:
            regions.append((source, box, False))
    replacements = []
    def add(source, box, lintel=False):
        obj = clipped_copy(source, box, root)
        if obj:
            obj['icd_role'] = 'INTACT'
            if lintel: obj['masonry_lintel'] = True
            replacements.append(obj)
    for source, box, lintel in regions:
        a,b = max(box[0][0],low+depth), min(box[0][1],high-depth)
        if b-a > 1e-6: add(source, [[a,b],box[1],box[2]], lintel)
        for row in range(math.ceil((top-bottom)/course_height)):
            if row%2 != phase: continue
            z0,z1 = max(box[2][0],bottom+row*course_height), min(box[2][1],bottom+(row+1)*course_height)
            if z1-z0 < 1e-6: continue
            for x0,x1 in ((low,low+depth),(high-depth,high)):
                a,b = max(box[0][0],x0),min(box[0][1],x1)
                if b-a > 1e-6: add(source, [[a,b],box[1],[z0,z1]])
    for source in sources: core.remove_owned(source)
    root['masonry_corner_phase'] = phase
    context.view_layer.update()


def clipped_copy(source, bounds, root):
    mesh = source.data.copy()
    mesh.transform(core.rest_matrix(source))
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        for axis in (0, 2):
            for value, outer in ((bounds[axis][0], False), (bounds[axis][1], True)):
                point, normal = Vector(), Vector()
                point[axis], normal[axis] = value, 1
                result = bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                    plane_co=point, plane_no=normal, dist=1e-7, clear_inner=not outer, clear_outer=outer)
                edges = [e for e in result['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
                for face in bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces'] if edges else []:
                    face.material_index = 1
        if not bm.faces or abs(bm.calc_volume()) < 1e-10 or any(max(v.co[k] for v in bm.verts)-min(v.co[k] for v in bm.verts)<1e-5 for k in range(3)):
            bpy.data.meshes.remove(mesh)
            return None
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
    finally:
        bm.free()
    obj = bpy.data.objects.new('masonry_unit', mesh)
    root.users_collection[0].objects.link(obj)
    obj.parent = root
    obj.matrix_local = Matrix.Identity(4)
    return obj


def bounds(obj):
    points = [core.rest_matrix(obj) @ v.co for v in obj.data.vertices]
    return [[min(p[i] for p in points), max(p[i] for p in points)] for i in range(3)]


def geometry_nodes_units(root, units):
    """Editable placement mesh -> attribute-sized cube instances -> real units.

    The generator remains in the blend; evaluated pieces enter the same tool path.
    Placement clipping is authored before the GN volume generation.
    """
    bpy.context.view_layer.update()
    label='Coursed stone' if is_stone(root.icd_settings) else 'Running bond'
    mesh = bpy.data.meshes.new(label+' placements')
    boxes = [bounds(o) for o in units]
    for unit,box in zip(units,boxes):
        bm=bmesh.new()
        try:
            bm.from_mesh(unit.data)
            actual=abs(bm.calc_volume()*core.rest_matrix(unit).to_3x3().determinant())
        finally:bm.free()
        if abs(actual-math.prod(b-a for a,b in box))>max(1e-8,actual*1e-4):
            raise ValueError('New GN walls require rectangular regions; use Bisect existing wall for this shape')
    mesh.from_pydata([[(a+b)/2 for a,b in box] for box in boxes], [], [])
    attribute_name='stone_size' if is_stone(root.icd_settings) else 'brick_size'
    attribute = mesh.attributes.new(attribute_name, 'FLOAT_VECTOR', 'POINT')
    for item, box in zip(attribute.data, boxes):
        item.vector = [b-a for a,b in box]
    obj = bpy.data.objects.new(label+' · Geometry Nodes', mesh)
    root.users_collection[0].objects.link(obj)
    obj.parent = root
    obj.matrix_local = Matrix.Identity(4)
    obj['icd_role'] = 'GENERATOR'
    group = bpy.data.node_groups.new(label+' units', 'GeometryNodeTree')
    group.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    group.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nodes, links = group.nodes, group.links
    source = nodes.new('NodeGroupInput')
    cube = nodes.new('GeometryNodeMeshCube')
    cube.inputs['Size'].default_value = (1,1,1)
    size = nodes.new('GeometryNodeInputNamedAttribute')
    size.data_type = 'FLOAT_VECTOR'
    size.inputs['Name'].default_value = attribute_name
    instance = nodes.new('GeometryNodeInstanceOnPoints')
    realise = nodes.new('GeometryNodeRealizeInstances')
    output = nodes.new('NodeGroupOutput')
    links.new(source.outputs['Geometry'], instance.inputs['Points'])
    links.new(cube.outputs['Mesh'], instance.inputs['Instance'])
    links.new(size.outputs['Attribute'], instance.inputs['Scale'])
    links.new(instance.outputs['Instances'], realise.inputs['Geometry'])
    links.new(realise.outputs['Geometry'], output.inputs['Geometry'])
    modifier = obj.modifiers.new(label+' generator', 'NODES')
    modifier.node_group = group
    bpy.context.view_layer.update()
    evaluated = core.evaluated_copy(bpy.context, obj, root.users_collection[0], root)
    # Separate actual evaluated GN volumes, retaining the generator as an editable source.
    core.select_only(bpy.context, [evaluated])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    result = [o for o in bpy.context.selected_objects if o.data.polygons]
    bpy.context.view_layer.update()
    for old in units:
        core.remove_owned(old)
    obj.hide_set(True)
    obj.hide_render = True
    return result


def build(context, root):
    context.view_layer.update()
    old_generators=core.objects(root,'GENERATOR')
    s = root.icd_settings
    length, height, depth = unit_size(s)
    if min(length, height, depth) <= s.mortar_gap:
        raise ValueError('Mortar gap must be smaller than every unit dimension')
    sources = core.objects(root, 'INTACT')
    points = [core.rest_matrix(o) @ v.co for o in sources for v in o.data.vertices]
    low = [min(p[i] for p in points) for i in range(3)]
    high = [max(p[i] for p in points) for i in range(3)]
    if high[1]-low[1] > depth+1e-5:
        raise ValueError('Masonry supports a single leaf no thicker than unit depth')
    boundaries=sorted({value for source in sources for value in bounds(source)[0]})
    courses=[course_spans(s,low[0],high[0],row,boundaries) for row in range(math.ceil((high[2]-low[2])/height))]
    # Lintel sources bypass course cutting; their actual volume is retained.
    units = []
    surface = bpy.data.materials.get('masonry_surface') or bpy.data.materials.new('masonry_surface')
    interior = bpy.data.materials.get('masonry_interior') or bpy.data.materials.new('masonry_interior')
    for source in ([] if is_fieldstone(s) else sources):
        source_box = bounds(source)
        if source.get('masonry_lintel'):
            unit = core.evaluated_copy(context, source, root.users_collection[0], root)
            unit['masonry_lintel'] = True
            units.append(unit)
            continue
        source.data.materials.clear()
        source.data.materials.append(surface)
        source.data.materials.append(interior)
        for row in range(math.ceil((high[2]-low[2])/height)):
            z0, z1 = low[2]+row*height, min(high[2], low[2]+(row+1)*height)
            if min(z1,source_box[2][1])-max(z0,source_box[2][0]) < 1e-6: continue
            for x0,x1 in courses[row]:
                if min(x1,source_box[0][1])-max(x0,source_box[0][0]) < 1e-6: continue
                unit = clipped_copy(source, [[x0,x1], [low[1],high[1]], [z0,z1]], root)
                if unit:
                    units.append(unit)
    if is_fieldstone(s):units=fieldstone_units(root,sources,low,high)
    if not units:
        raise ValueError('No units after clipping')
    # GN cube generation is deliberately bounded to rectangular clipped units.
    # Existing arbitrary wall meshes retain their actual bisected geometry.
    if s.masonry_input == 'NEW' and not is_fieldstone(s):
        lintels = [o for o in units if o.get('masonry_lintel')]
        bricks = [o for o in units if not o.get('masonry_lintel')]
        units = geometry_nodes_units(root, bricks)+lintels
    core.prepare_parts(root)
    core.finish_parts(context, root, units)
    units.sort(key=lambda o:(round(bounds(o)[2][0],6),round(bounds(o)[0][0],6),o.name))
    if s.border_detail>0 and not is_fieldstone(s):
        preliminary=[]
        for i,u in enumerate(units):
            b=bounds(u)
            preliminary.append({'id':str(i),'bounds':[[b[0][0],b[2][0],-b[1][1]],[b[0][1],b[2][1],-b[1][0]]],'lintel':bool(u.get('masonry_lintel'))})
        cluster(root,preliminary)
        lookup={u['id']:u for u in preliminary}
        rng=random.Random(s.seed+101)
        replacements=[]
        for obj,u in zip(units,preliminary):
            border=any(lookup[n]['clusterId']!=u['clusterId'] for n in u['neighbours'])
            b=bounds(obj)
            if border and not u['lintel'] and b[0][1]-b[0][0]>.12 and rng.random()<s.border_detail:
                middle=sum(b[0])/2
                left=[p[:] for p in b];right=[p[:] for p in b]
                left[0][1]=middle;right[0][0]=middle
                replacements.extend([clipped_copy(obj,left,root),clipped_copy(obj,right,root)])
                core.remove_owned(obj)
            else:replacements.append(obj)
        units=[o for o in replacements if o]
        core.finish_parts(context,root,units)
        units.sort(key=lambda o:(round(bounds(o)[2][0],6),round(bounds(o)[0][0],6),o.name))
    construction = []
    for index, unit in enumerate(units):
        unit['icd_uid'] = '%s_u%03d' % (s.asset_id,index)
        unit.icd_piece.mode = 'DYNAMIC'
        unit.icd_piece.section = 'masonry'
        box = bounds(unit)
        construction.append({'id':unit['icd_uid'], 'bounds':[[box[0][0],box[2][0],-box[1][1]], [box[0][1],box[2][1],-box[1][0]]],
                             'lintel':bool(unit.get('masonry_lintel')),'renderVertices':sum((len(p.vertices)-2)*3 for p in unit.data.polygons)})
        if is_fieldstone(s) or s.facade_enabled:construction[-1]['outline']=outline(unit)
        # Visible gaps do not change construction support/adjacency.
        centre = [sum(pair)/2 for pair in box]
        for vertex in unit.data.vertices:
            p = core.rest_matrix(unit) @ vertex.co
            for axis in (0,2):
                span = box[axis][1]-box[axis][0]
                if span < 1e-8:
                    raise ValueError('Degenerate unit %s: %s (%s vertices)' % (unit.name,box,len(unit.data.vertices)))
                p[axis] = centre[axis]+(p[axis]-centre[axis])*max(.1,1-s.mortar_gap/span)
            vertex.co = core.rest_matrix(unit).inverted() @ p
        if is_fieldstone(s) and not unit.get('masonry_lintel') and s.stone_bevel>0:
            round_fieldstone(unit,s.stone_bevel,s.mortar_gap)
            construction[-1]['renderVertices']=sum((len(p.vertices)-2)*3 for p in unit.data.polygons)
        elif is_stone(s) and s.stone_bevel>0:
            modifier=unit.modifiers.new('Stone edge bevel','BEVEL')
            modifier.width=min(s.stone_bevel,min(b-a for a,b in box)*(.35 if is_fieldstone(s) and not unit.get('masonry_lintel') else .15))
            modifier.segments=1
            modifier.limit_method='ANGLE'
            context.view_layer.update()
            old=unit.data
            unit.data=bpy.data.meshes.new_from_object(unit.evaluated_get(context.evaluated_depsgraph_get()),preserve_all_data_layers=True,depsgraph=context.evaluated_depsgraph_get())
            unit.modifiers.remove(modifier)
            if old.users==0:bpy.data.meshes.remove(old)
            construction[-1]['renderVertices']=sum((len(p.vertices)-2)*3 for p in unit.data.polygons)
        # All unit side/top/bottom faces become exposed joint interiors.
        marker = unit.data.attributes.get('structure_interior') or unit.data.attributes.new('structure_interior','BOOLEAN','FACE')
        for face in unit.data.polygons:
            marker.data[face.index].value = abs(face.normal.y)<.9
    cluster(root, construction)
    root['masonry_units'] = json.dumps(construction)
    structure_parts.tag(root, s.structure_type, s.structure_material, s.structure_variant, s.seed)
    s.body_budget = 128
    if len(units)>128:
        s.body_budget = len(units)  # UI maximum remains a hard export limit.
    root['masonry_signature']=signature(root)
    for generator in old_generators:core.remove_owned(generator)
    return units


def cluster(root, units):
    s = root.icd_settings
    fieldstone=is_fieldstone(s)
    length,height,_=unit_size(s)
    rng = random.Random(s.seed)
    centres = [[(u['bounds'][0][i]+u['bounds'][1][i])/2 for i in (0,1)] for u in units]
    count = max(1,round(len(units)/s.units_per_chunk))
    seeds = rng.sample(centres,min(count,len(centres)))
    transforms = [(rng.uniform(-s.cluster_rotation,s.cluster_rotation),rng.uniform(1,s.cluster_stretch),rng.uniform(1,s.cluster_stretch)) for _ in seeds]
    phase = rng.random()*100
    for unit, centre in zip(units,centres):
        x,y = centre[0]/(length if fieldstone else length/2),centre[1]/height
        x += s.cluster_warp*math.sin(y*s.cluster_frequency+phase)
        y += s.cluster_warp*math.sin(x*s.cluster_frequency+phase*.7)
        x += rng.uniform(-s.cluster_jitter,s.cluster_jitter)
        y += rng.uniform(-s.cluster_jitter,s.cluster_jitter)
        scores=[]
        for seed,(angle,sx,sy) in zip(seeds,transforms):
            dx,dy=x-seed[0]/(length if fieldstone else length/2),y-seed[1]/height
            a,b=math.cos(angle),math.sin(angle)
            dx,dy=(a*dx+b*dy)/sx,(-b*dx+a*dy)/sy
            scores.append(abs(dx)**s.cluster_p+s.course_weight*abs(dy)**s.cluster_p)
        unit['clusterId']='c%03d'%min(range(len(scores)),key=lambda i:(scores[i],i))
    # Neighbours from positive-area construction interfaces; mortar gaps irrelevant.
    bonds=[]
    for i,a in enumerate(units):
        a['supports']=[]
        a['neighbours']=[]
    for i,a in enumerate(units):
        for b in units[i+1:]:
            if fieldstone:
                interface=shared_edge(a['outline'],b['outline'])
                if not interface:continue
                start,end=interface
                delta=Vector(end)-Vector(start);normal=[-delta.y/delta.length,delta.x/delta.length,0]
                ca=[sum(pair)/2 for pair in zip(*a['bounds'])];cb=[sum(pair)/2 for pair in zip(*b['bounds'])]
                if sum(normal[k]*(cb[k]-ca[k]) for k in (0,1))<0:normal=[-n for n in normal]
                depth=min(a['bounds'][1][2],b['bounds'][1][2])-max(a['bounds'][0][2],b['bounds'][0][2])
                bonds.append({'id':'m%04d'%len(bonds),'a':a['id'],'b':b['id'],'position':[(start[0]+end[0])/2,(start[1]+end[1])/2,(ca[2]+cb[2])/2],'normal':normal,'areaM2':delta.length*depth,'kind':'mortar','fractureLevel':2 if a['clusterId']==b['clusterId'] else 1})
                a['neighbours'].append(b['id']);b['neighbours'].append(a['id'])
                if abs(normal[1])>1e-5 and abs(ca[1]-cb[1])>1e-6:
                    (b if cb[1]>ca[1] else a)['supports'].append((a if cb[1]>ca[1] else b)['id'])
                continue
            lo=[max(a['bounds'][0][k],b['bounds'][0][k]) for k in range(3)]
            hi=[min(a['bounds'][1][k],b['bounds'][1][k]) for k in range(3)]
            axis=next((k for k in (0,1) if abs(hi[k]-lo[k])<1e-5 and all(hi[j]-lo[j]>1e-5 for j in range(3) if j!=k)),None)
            if axis is None: continue
            normal=[0,0,0]
            normal[axis]=1 if b['bounds'][0][axis]>a['bounds'][0][axis] else -1
            area=math.prod(hi[j]-lo[j] for j in range(3) if j!=axis)
            bonds.append({'id':'m%04d'%len(bonds),'a':a['id'],'b':b['id'],'position':[(lo[k]+hi[k])/2 for k in range(3)],'normal':normal,'areaM2':area,'kind':'mortar','fractureLevel':2 if a['clusterId']==b['clusterId'] else 1})
            a['neighbours'].append(b['id']);b['neighbours'].append(a['id'])
            if axis==1:
                (b if normal[1]>0 else a)['supports'].append((a if normal[1]>0 else b)['id'])
    # Connected components per assignment. Never make disconnected compound chunks.
    by_id={u['id']:u for u in units}
    seen=set()
    for unit in units:
        if unit['id'] in seen: continue
        original=unit['clusterId'];pending=[unit];component=[]
        while pending:
            u=pending.pop()
            if u['id'] in seen: continue
            seen.add(u['id']);component.append(u)
            pending += [by_id[n] for n in u['neighbours'] if n not in seen and by_id[n]['clusterId']==original]
        name='cluster_%03d'%sum(1 for u in units if u.get('clusterRoot'))
        component[0]['clusterRoot']=True
        for u in component:u['clusterId']=name
    bottom=min(u['bounds'][0][1] for u in units)
    for u in units:
        u['foundation']=abs(u['bounds'][0][1]-bottom)<1e-5
        u.pop('clusterRoot',None)
    for bond in bonds:
        bond['fractureLevel']=2 if by_id[bond['a']]['clusterId']==by_id[bond['b']]['clusterId'] else 1
    # Peel 1-3 connected border units, preserving explicit delayed attachments.
    if s.border_detail>0:
        peeled=set()
        for unit in units:
            parent=unit['clusterId']
            if unit['id'] in peeled or unit['lintel'] or not any(by_id[n]['clusterId']!=parent for n in unit['neighbours']) or rng.random()>s.border_detail*.25:continue
            group=[unit]
            for n in unit['neighbours']:
                other=by_id[n]
                if len(group)>=rng.randint(1,3):break
                if n not in peeled and other['clusterId']==parent and not other['lintel']:group.append(other)
            # Never consume an entire parent chunk.
            if sum(u['clusterId']==parent for u in units)<=len(group):continue
            remaining={u['id'] for u in units if u['clusterId']==parent and u not in group}
            reached=set();pending=[next(iter(remaining))]
            while pending:
                uid=pending.pop()
                if uid in reached:continue
                reached.add(uid);pending.extend(n for n in by_id[uid]['neighbours'] if n in remaining and n not in reached)
            if reached!=remaining:continue
            name='mini_'+unit['id']
            for u in group:
                u['clusterId']=name;u['miniParent']=parent;peeled.add(u['id'])
        for bond in bonds:bond['fractureLevel']=2 if by_id[bond['a']]['clusterId']==by_id[bond['b']]['clusterId'] else 1
    root['masonry_bonds']=json.dumps(bonds)


def shared_edge(a,b):
    """Positive-length overlap of actual pre-inset cell boundaries, not AABBs."""
    for p,q in zip(a,a[1:]+a[:1]):
        p,q=Vector(p),Vector(q);edge=q-p;length=edge.length
        if length<1e-7:continue
        direction=edge/length
        for r,t in zip(b,b[1:]+b[:1]):
            r,t=Vector(r),Vector(t)
            if any(abs(edge.x*(v.y-p.y)-edge.y*(v.x-p.x))/length>2e-6 for v in (r,t)):continue
            lo=max(0,min((r-p).dot(direction),(t-p).dot(direction)))
            hi=min(length,max((r-p).dot(direction),(t-p).dot(direction)))
            if hi-lo>1e-5:return [list(p+direction*lo),list(p+direction*hi)]
    return None


def metadata(root, meters, volumes):
    if abs(meters-1)>1e-8:
        raise ValueError('Masonry batch requires metre scene units')
    data,revision=structure_parts.profiles()
    if root.get('masonry_signature')!=signature(root):
        raise ValueError('Masonry geometry/IDs changed; rebuild units before export')
    if root.get('structure_profile_revision')!=revision:
        raise ValueError('Material profiles changed; rebuild masonry')
    for obj,proxy_volume in volumes.items():
        bm=bmesh.new()
        try:
            bm.from_mesh(obj.data)
            actual=abs(bm.calc_volume()*core.rest_matrix(obj).to_3x3().determinant())
        finally:bm.free()
        if abs(actual-proxy_volume)>max(1e-8,actual*1e-4):
            raise ValueError('Unit proxy fills a void or non-convex region: split source into convex regions and rebuild')
    units=json.loads(root['masonry_units']);bonds=json.loads(root['masonry_bonds'])
    if root.icd_settings.facade_enabled and any('outline' not in u for u in units):
        raise ValueError('Facade footprints are missing; rebuild masonry units before export')
    part=json.loads(root['structure_part'])
    boxes=[bounds(o) for o in core.objects(root,'INTACT')]
    size=[max(b[k][1] for b in boxes)-min(b[k][0] for b in boxes) for k in (0,2,1)]
    part['sizeM']=[round(v,6) for v in size]
    profile=data['materials'][part['materialId']]
    root.icd_settings.mass=sum(volumes.values())*profile['densityKgM3']
    root.icd_settings.break_energy=sum(b['areaM2'] for b in bonds if b['fractureLevel']==1)*profile['fractureEnergyJPerM2']
    clusters=[]
    for name in sorted({u['clusterId'] for u in units}):
        ids=[u['id'] for u in units if u['clusterId']==name]
        adjacent=sorted({u['clusterId'] for u in units if u['id'] not in ids and any(n in ids for n in u['neighbours'])})
        mini=next((u.get('miniParent') for u in units if u['clusterId']==name),None)
        clusters.append({'id':name,'node':root.icd_settings.asset_id+'_'+name,'unitIds':ids,'neighbours':adjacent,**({'miniParent':mini,'releaseDelay':.18} if mini else {})})
    for i,u in enumerate(units):u['renderId']=i
    stone=is_stone(root.icd_settings)
    return {'version':2,'material':part['materialId'],'part':part,'profileRevision':revision,'bonds':bonds,'joints':[],'sockets':[],
            'masonry':{'version':1,'pattern':'rubble_stone' if is_fieldstone(root.icd_settings) else 'coursed_stone' if stone else 'running_bond','input':'authored_cells' if is_fieldstone(root.icd_settings) else root.icd_settings.masonry_input.lower(),'units':units,'clusters':clusters,
                       'settings':{**{key:getattr(root.icd_settings,key) for key in ('units_per_chunk','cluster_p','course_weight','cluster_warp','cluster_frequency','cluster_rotation','cluster_stretch','cluster_jitter','mortar_gap','border_detail')},**({'unitSizeM':list(unit_size(root.icd_settings)),'lengthVariation':root.icd_settings.stone_length_variation,'bevelM':root.icd_settings.stone_bevel} if stone else {}),**({'irregularity':root.icd_settings.stone_irregularity} if is_fieldstone(root.icd_settings) else {})},
                       **({'facade':facade_metadata(root,units)} if root.icd_settings.facade_enabled else {})},
            'validation':{'physicalChunks':len(units),'collisionHulls':len(units),'renderTriangles':sum(len(p.vertices)-2 for o in core.objects(root,'PIECE') for p in o.data.polygons),'connectedComponents':1}}


def polygon_area(polygon):
    return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(polygon,polygon[1:]+polygon[:1])))/2


def facade_metadata(root,units):
    """Independent brittle sheet graph; coverage is not a masonry crack pattern."""
    s=root.icd_settings
    sources=core.objects(root,'INTACT');boxes=[bounds(o) for o in sources]
    low=[min(b[k][0] for b in boxes) for k in range(3)];high=[max(b[k][1] for b in boxes) for k in range(3)]
    regions=[outline(o) for o in sources]
    def solid_origin(point):
        candidates=[]
        for polygon in regions:
            direction=sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(polygon,polygon[1:]+polygon[:1]))
            inside=all(((b[0]-a[0])*(point.y-a[1])-(b[1]-a[1])*(point.x-a[0]))*direction>=-1e-10 for a,b in zip(polygon,polygon[1:]+polygon[:1]))
            closest=point
            if not inside:
                options=[]
                for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                    a,b=Vector(a),Vector(b);edge=b-a
                    options.append(a+edge*max(0,min(1,(point-a).dot(edge)/edge.length_squared)))
                closest=min(options,key=lambda p:(p-point).length_squared)
            centre=sum((Vector(p) for p in polygon),Vector((0,0)))/len(polygon)
            candidates.append(((closest-point).length_squared,closest.lerp(centre,.02)))
        return min(candidates,key=lambda c:c[0])[1]
    origins=[]
    for y in (1/6,1/2,5/6):
        for x in (1/6,1/2,5/6):
            point=solid_origin(Vector((low[0]+(high[0]-low[0])*x,low[2]+(high[2]-low[2])*y)))
            point=[round(v,6) for v in point]
            if point not in origins:origins.append(point)
    variants=[];sectors=14
    corners=[Vector((x,y)) for x in (low[0],high[0]) for y in (low[2],high[2])]
    for i,origin in enumerate(origins):
        rng=random.Random(s.seed+509+i*997);phase=rng.uniform(-.1,.1)
        radius=max((p-Vector(origin)).length for p in corners)/math.cos(1.4*math.pi/sectors)*1.03
        angles=[phase+2*math.pi*(k+rng.uniform(-.18,.18))/sectors for k in range(sectors)]
        outer=[(origin[0]+math.cos(a)*radius,origin[1]+math.sin(a)*radius) for a in angles]
        polygons=list(structure_parts.radial_polygons(outer,sectors,max(2,math.ceil(radius/s.facade_shard_size)),centre=origin,jitter=.24,seed=s.seed+i*997,irregular=True))
        patches=facade_patches(polygons,regions,units)
        variants.append({'id':'w%02d'%i,'node':s.asset_id+'_facade_w%02d'%i,'origin':origin,'patches':patches})
    default=min(variants,key=lambda v:sum(n*n for n in v['origin']))
    return {'version':3,'node':default['node'],'materialId':'render','thicknessM':s.facade_thickness,'revealBorder':s.facade_border,'shardSizeM':s.facade_shard_size,'faces':'front','variants':variants}


def facade_patches(polygons,regions,units):
    """Clip pre-authored web shards to real wall regions and map their support."""
    patches=[]
    for sector in polygons:
            for region in regions:
                polygon=structure_parts.clip_polygon(sector,region)
                if len(polygon)<3 or polygon_area(polygon)<1e-7:continue
                # Clipping already preserves convex winding. Keep narrow triangles:
                # Blender's 2D hull can collapse these to two vertices.
                points=[]
                for p in polygon:
                    point=[round(p[0],7),round(p[1],7)]
                    if not points or point!=points[-1]:points.append(point)
                if len(points)>1 and points[0]==points[-1]:points.pop()
                polygon=points
                if len(polygon)<3 or polygon_area(polygon)<1e-7:continue
                lo=[min(p[k] for p in polygon) for k in range(2)];hi=[max(p[k] for p in polygon) for k in range(2)]
                covered=[]
                for u in units:
                    if any(min(hi[k],u['bounds'][1][k])-max(lo[k],u['bounds'][0][k])<1e-7 for k in range(2)):continue
                    overlap=structure_parts.clip_polygon(polygon,u['outline'])
                    if len(overlap)>=3 and polygon_area(overlap)>1e-8:covered.append(u['id'])
                if not covered:raise ValueError('Facade shard has no construction support')
                patches.append({'id':'f%04d'%len(patches),'renderId':len(patches),'outline':polygon,'areaM2':polygon_area(polygon),'unitIds':covered,'neighbours':[]})
    patch_bounds=[[[min(p[k] for p in patch['outline']),max(p[k] for p in patch['outline'])] for k in range(2)] for patch in patches]
    for i,a in enumerate(patches):
        for j in range(i+1,len(patches)):
            if any(min(patch_bounds[i][k][1],patch_bounds[j][k][1])-max(patch_bounds[i][k][0],patch_bounds[j][k][0]) < -2e-6 for k in range(2)):continue
            b=patches[j]
            if shared_edge(a['outline'],b['outline']):a['neighbours'].append(b['id']);b['neighbours'].append(a['id'])
    missing={u['id'] for u in units}-{uid for p in patches for uid in p['unitIds']}
    if missing:raise ValueError('Facade does not cover masonry units: '+str([(u['id'],u['bounds'],u['outline']) for u in units if u['id'] in missing]))
    return patches


def merge_export_nodes(context, nodes, manifest, metadata):
    """One merged GLB node per cluster, with export-stable vertex unit IDs."""
    by_id={p['id']:p for p in manifest['pieces']}
    for cluster in metadata['masonry']['clusters']:
        objects=[]
        for unit in metadata['masonry']['units']:
            if unit['clusterId']!=cluster['id']: continue
            source=next(o for o in nodes if o.get('icd_uid')==unit['id'])
            node=nodes[source]
            attr=node.data.attributes.new('_unit_id','FLOAT','POINT')
            for item in attr.data:item.value=unit['renderId']
            by_id[unit['id']]['node']=cluster['node']
            objects.append(node)
        core.select_only(context,objects,objects[0])
        if len(objects)>1:bpy.ops.object.join()
        objects[0].name=cluster['node']
        objects[0]['icd_cluster_id']=cluster['id']
        if 'icd_piece_id' in objects[0]:del objects[0]['icd_piece_id']


def export_facade(root, parent, collection, metadata):
    """Authored cosmetic patches with unit IDs; no colliders or mass owners."""
    m=metadata['masonry'];spec=m.get('facade')
    if not spec:return
    for pattern in spec.get('variants',[spec]):export_facade_pattern(root,parent,collection,m,spec,pattern)


def export_facade_pattern(root,parent,collection,m,spec,pattern):
    profiles,_=structure_parts.profiles();atlas=profiles['atlas'];row=profiles['materials']['render']['atlas']['row']
    inset=(atlas['paddingPixels']+.5)/atlas['tilePixels']
    low=[min(u['bounds'][0][k] for u in m['units']) for k in range(3)]
    high=[max(u['bounds'][1][k] for u in m['units']) for k in range(3)]
    vertices=[];faces=[];ids=[];cuts=[]
    for unit in pattern.get('patches',m['units']):
        polygon=unit['outline'];n=len(polygon);start=len(vertices)
        # Blender -Y is glTF +Z. Inner plane is clear of the masonry tips.
        for depth in (high[2]+.0005,high[2]+.0005+spec['thicknessM']):
            vertices.extend((x,-depth,y) for x,y in polygon);ids.extend([unit['renderId']]*n)
        faces.extend([tuple(start+i for i in range(n-1,-1,-1)),tuple(start+n+i for i in range(n))]);cuts.extend([True,False])
        for i in range(n):faces.append((start+i,start+(i+1)%n,start+n+(i+1)%n,start+n+i));cuts.append(True)
    mesh=bpy.data.meshes.new(pattern['node']);mesh.from_pydata(vertices,[],faces);mesh.update()
    # Recalculate winding without changing the pre-authored unit identities.
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    attr=mesh.attributes.new('_patch_id' if spec['version']>=2 else '_unit_id','FLOAT','POINT')
    for item,uid in zip(attr.data,ids):item.value=uid
    uv=mesh.uv_layers.new(name='UVMap')
    for face,cut in zip(mesh.polygons,cuts):
        for loop in face.loop_indices:
            p=mesh.vertices[mesh.loops[loop].vertex_index].co
            x=inset+(p.x-low[0])/max(high[0]-low[0],1e-8)*(1-2*inset)
            y=inset+(p.z-low[1])/max(high[1]-low[1],1e-8)*(1-2*inset)
            uv.data[loop].uv=((int(cut)+x)/atlas['columns'],(row+y)/atlas['rows'])
    mesh.materials.append(core.objects(root,'PIECE')[0].data.materials[0])
    obj=bpy.data.objects.new(pattern['node'],mesh);collection.objects.link(obj);obj.parent=parent;obj['icd_role']='facade'

