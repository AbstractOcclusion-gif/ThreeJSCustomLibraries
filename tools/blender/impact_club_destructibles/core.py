# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender authoring state. Originals are never used as fracture operands."""
import math
import random
import re
import uuid

import bpy
import bmesh
from mathutils import Matrix, Vector

from .vendor.cell_fracture import fracture_cell_setup

PRESETS = {
    "WOOD": (3.0, 8.0, .35, .12, "wood"),
    "STONE": (40.0, 120.0, .5, .08, "stone"),
    "BRICK": (40.0, 18000.0, .6, .03, "brick"),
    "CONCRETE": (40.0, 25000.0, .6, .03, "concrete"),
    "GLASS": (2.0, 3.0, .3, .05, "glass"),
    "METAL": (15.0, 80.0, .4, .15, "metal"),
}


def slug(value):
    return re.sub(r"[^a-z0-9_]+", "_", value.lower()).strip("_") or "destructible"


def root_for(obj):
    while obj:
        if obj.get("icd_role") == "ROOT":
            return obj
        obj = obj.parent
    return None


def objects(root, role):
    return sorted((o for o in root.children_recursive if o.get("icd_role") == role), key=lambda o: o.name)


def rest_matrix(obj):
    root = root_for(obj)
    if root and root.icd_settings.preview > 0 and "icd_rest" in obj:
        values = obj["icd_rest"]
        return Matrix([values[i:i + 4] for i in range(0, 16, 4)])
    return obj.matrix_local.copy()


def save_rest(obj):
    obj["icd_rest"] = [x for row in obj.matrix_local for x in row]


def remove_owned(obj):
    try:
        if obj.name not in bpy.data.objects:
            return
    except ReferenceError:
        return
    for child in list(obj.children):
        remove_owned(child)
    mesh = obj.data if obj.type == "MESH" else None
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def set_view(root):
    s = root.icd_settings
    for obj in objects(root, "INTACT"):
        obj.hide_set(s.view != "INTACT")
        obj.hide_render = s.view != "INTACT"
    for obj in objects(root, "PIECE"):
        obj.hide_set(s.view != "PIECES")
        obj.hide_render = s.view != "PIECES"
    for obj in objects(root, "COLLIDER"):
        owner_role = obj.parent.get("icd_role")
        visible = s.show_colliders and ((s.view == "INTACT" and owner_role == "INTACT") or (s.view == "PIECES" and owner_role == "PIECE"))
        obj.hide_set(not visible)
        obj.hide_render = True


def preview(root):
    s = root.icd_settings
    previous = root.get("icd_preview_previous", 0.0)
    parts = objects(root, "PIECE")
    if previous == 0:
        for part in parts:
            save_rest(part)
    # Fixed direction per piece; geometry edits and viewport rotations are untouched.
    for i, part in enumerate(parts):
        values = part.get("icd_rest")
        if values is None:
            continue
        matrix = Matrix([values[j:j + 4] for j in range(0, 16, 4)])
        direction = matrix.translation.copy()
        if direction.length < .01:
            a = i * 2.399963
            direction = Vector((math.cos(a), math.sin(a), .4))
        direction.normalize()
        matrix.translation += direction * s.preview
        part.matrix_local = matrix
    root["icd_preview_previous"] = s.preview
    if bpy.context.view_layer:
        bpy.context.view_layer.update()


def select_only(context, selected, active=None):
    for obj in context.view_layer.objects:
        obj.select_set(False)
    for obj in selected:
        obj.hide_set(False)
        obj.select_set(True)
    context.view_layer.objects.active = active or (selected[0] if selected else None)


def evaluated_copy(context, source, collection, parent=None):
    deps = context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
    obj = bpy.data.objects.new(source.name + "_copy", mesh)
    collection.objects.link(obj)
    matrix = source.matrix_world.copy()
    if parent:
        matrix = parent.matrix_world.inverted() @ matrix
    mesh.transform(matrix)
    mesh.update()
    obj.parent = parent
    obj.matrix_local = Matrix.Identity(4)
    return obj


def recenter(obj):
    if not obj.data.vertices:
        return
    center = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
    obj.data.transform(Matrix.Translation(-center))
    obj.matrix_local = obj.matrix_local @ Matrix.Translation(center)
    obj.data.update()


def create_asset(context):
    sources = sorted((o for o in context.selected_objects if o.type == "MESH"), key=lambda o: o.name)
    if not sources or any(root_for(o) for o in sources):
        raise ValueError("Select ordinary source mesh objects, outside an existing destruction asset")
    if any(o.find_armature() for o in sources):
        raise ValueError("Use static props; armatures are not supported")
    name = slug(context.active_object.name if context.active_object in sources else sources[0].name)
    collection = bpy.data.collections.new("ICD_" + name)
    context.scene.collection.children.link(collection)
    root = bpy.data.objects.new("ICD_" + name, None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = .4
    root.location = sources[0].matrix_world.translation
    root["icd_role"] = "ROOT"
    root["icd_uid"] = uuid.uuid4().hex
    s = root.icd_settings
    s.asset_id = name
    s.source_note = "; ".join(o.name for o in sources)
    root["icd_meters_per_unit"] = context.scene.unit_settings.scale_length
    context.view_layer.update()
    for i, source in enumerate(sources):
        obj = evaluated_copy(context, source, collection, root)
        obj.name = "intact_%03d" % i
        obj["icd_role"] = "INTACT"
        recenter(obj)
        source.hide_set(True)
    context.scene.icd_active_asset = root
    select_only(context, [root])
    return root


def prepare_parts(root):
    if root.icd_settings.preview:
        root.icd_settings.preview = 0
    for part in list(objects(root, "PIECE")):
        remove_owned(part)


def finish_parts(context, root, parts):
    context.view_layer.update()
    if not parts:
        raise ValueError("No pieces were produced; check that the source contains usable geometry")
    for i, obj in enumerate(sorted(parts, key=lambda o: o.name)):
        obj.name = "piece_%03d" % i
        obj["icd_role"] = "PIECE"
        obj["icd_uid"] = uuid.uuid4().hex
        recenter(obj)
        context.view_layer.update()
        save_rest(obj)
    root.icd_settings.view = "PIECES"
    context.scene.icd_active_asset = root
    set_view(root)
    select_only(context, parts, parts[0])


def separate_parts(context, root, islands=True):
    # Build replacements first; failed generation never deletes authored pieces.
    collection = root.users_collection[0]
    created = []
    try:
        for source in objects(root, "INTACT"):
            obj = evaluated_copy(context, source, collection, root)
            select_only(context, [obj])
            if islands:
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.select_all(action="SELECT")
                bpy.ops.mesh.separate(type="LOOSE")
                bpy.ops.object.mode_set(mode="OBJECT")
                created.extend(list(context.selected_objects))
            else:
                created.append(obj)
        prepare_parts(root)
        finish_parts(context, root, created)
        return created
    except Exception:
        if context.object and context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for obj in created:
            if obj.name in bpy.data.objects:
                remove_owned(obj)
        raise


def is_closed(mesh):
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        return bool(bm.faces) and all(e.is_manifold for e in bm.edges)
    finally:
        bm.free()


def add_authored_pieces(context, root):
    sources = [o for o in context.selected_objects if o.type == "MESH" and root_for(o) is None]
    if not sources:
        raise ValueError("Select external authored meshes; choose the target Asset in this panel")
    created = []
    try:
        for source in sources:
            obj = evaluated_copy(context, source, root.users_collection[0], root)
            obj["icd_role"] = "PIECE"
            obj["icd_uid"] = uuid.uuid4().hex
            recenter(obj)
            save_rest(obj)
            created.append(obj)
        root.icd_settings.view = "PIECES"
        set_view(root)
        select_only(context, created)
    except Exception:
        for obj in created:
            remove_owned(obj)
        raise
    return created


def refresh_piece_ids(root):
    seen = set()
    for obj in objects(root, "PIECE"):
        uid = obj.get("icd_uid")
        if not uid or uid in seen:
            uid = uuid.uuid4().hex
            obj["icd_uid"] = uid
        seen.add(uid)


def fracture(context, root, *, preserve_cell_planes=False, cell_scale=(1, 1, 1), sources=None, replace=True, seed_bounds=None):
    context.view_layer.update()
    s = root.icd_settings
    scratch = bpy.data.collections.new("ICD_fracture_work")
    context.scene.collection.children.link(scratch)
    random_state = random.getstate()
    result = []
    try:
        # Work in a placement-free copy. Cell Fracture does its booleans in world space.
        inputs = []
        for intact in (sources if sources is not None else objects(root, "INTACT")):
            obj = evaluated_copy(context, intact, scratch, root)
            obj.parent = None
            inputs.append(obj)
        context.view_layer.update()
        select_only(context, inputs)
        if len(inputs) > 1:
            bpy.ops.object.join()
        operand = context.active_object
        if not is_closed(operand.data):
            raise ValueError("Voronoi needs closed mesh volumes. Use Separate Parts for open boards or foliage")
        bounds = [operand.matrix_world @ Vector(c) for c in operand.bound_box]
        lo = Vector([min(v[i] for v in bounds) for i in range(3)])
        hi = Vector([max(v[i] for v in bounds) for i in range(3)])
        if min(hi - lo) < .02:
            raise ValueError("This mesh is too thin for Cell Fracture's cleanup tolerance; use Separate Parts")
        material = bpy.data.materials.new(s.asset_id + "_interior")
        material.diffuse_color = s.interior_color
        material.use_nodes = True
        material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = s.interior_color
        operand.data.materials.append(material)
        index = len(operand.data.materials) - 1
        seed_mesh = bpy.data.meshes.new("ICD_seed_points")
        rng = random.Random(s.seed)
        seed_lo, seed_hi = seed_bounds if seed_bounds is not None else (lo, hi)
        seed_coordinates = [Vector(tuple(rng.uniform(seed_lo[i], seed_hi[i]) for i in range(3))) for _ in range(s.cell_count)]
        seed_mesh.from_pydata([tuple(p) for p in seed_coordinates], [], [])
        seeds = bpy.data.objects.new("ICD_seed_points", seed_mesh)
        scratch.objects.link(seeds)
        seeds.parent = operand
        seeds.matrix_world = Matrix.Identity(4)
        random.seed(s.seed)
        context.view_layer.update()
        cells = fracture_cell_setup.cell_fracture_objects(
            context, scratch, operand, source={"VERT_CHILD"}, source_limit=0,
            use_data_match=True, margin=0.0, material_index=index, use_debug_redraw=False,
            use_hull_noise=not preserve_cell_planes, cell_scale=cell_scale,
        )
        result = fracture_cell_setup.cell_fracture_boolean(
            context, scratch, operand, cells, use_island_split=False,
            use_debug_redraw=False, remove_doubles=True,
        )
        if seed_bounds is not None:
            volumes = []
            for obj in result:
                bm = bmesh.new()
                try:
                    bm.from_mesh(obj.data)
                    volume = abs(bm.calc_volume())
                finally:
                    bm.free()
                if volume <= 1e-9:
                    remove_owned(obj)
                else:
                    volumes.append(obj)
            result = volumes
        if len(result) < (1 if seed_bounds is not None else 2):
            raise ValueError("Fracture produced fewer than two pieces; change seed or mesh")
        context.view_layer.update()
        # Result coordinates are already root-local; reparent without preserving world placement.
        for obj in result:
            matrix = obj.matrix_world.copy()
            if seed_bounds is not None:
                obj['structure_cell'] = min(range(len(seed_coordinates)), key=lambda i: (matrix.translation-seed_coordinates[i]).length_squared)
            scratch.objects.unlink(obj)
            root.users_collection[0].objects.link(obj)
            obj.parent = root
            obj.matrix_local = matrix
        context.view_layer.update()
        if replace:
            prepare_parts(root)
        finish_parts(context, root, result)
        return result
    finally:
        random.setstate(random_state)
        for obj in list(scratch.objects):
            remove_owned(obj)
        bpy.data.collections.remove(scratch)


def box_bmesh(mesh):
    coords = [v.co for v in mesh.vertices]
    if not coords:
        raise ValueError("An object has no geometry")
    lo = Vector([min(v[i] for v in coords) for i in range(3)])
    hi = Vector([max(v[i] for v in coords) for i in range(3)])
    size = hi - lo
    if min(size) < .001:
        raise ValueError("A part is flat; mark it Cosmetic or give it thickness")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    center = (lo + hi) * .5
    for v in bm.verts:
        v.co = Vector([v.co[i] * size[i] + center[i] for i in range(3)])
    return bm


def invalid_hull(bm, tolerance=1e-5):
    bm.normal_update()
    return (len(bm.verts) > 64 or not bm.faces or
            not all(e.is_manifold for e in bm.edges) or abs(bm.calc_volume()) < 1e-9 or
            any(f.normal.dot(v.co - f.verts[0].co) > tolerance for f in bm.faces for v in bm.verts))


def generate_colliders(context, root):
    style = root.icd_settings.collider_style
    owners = objects(root, "INTACT") + objects(root, "PIECE")
    pending = []
    try:
        for owner in owners:
            if owner.get("icd_role") == "PIECE" and owner.icd_piece.mode == "COSMETIC":
                continue
            mesh = bpy.data.meshes.new_from_object(owner.evaluated_get(context.evaluated_depsgraph_get()))
            bm = None
            kind = style
            try:
                if style == "BOX":
                    bm = box_bmesh(mesh)
                else:
                    bm = bmesh.new()
                    for v in mesh.vertices:
                        bm.verts.new(v.co)
                    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
                    bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
                    unused = [v for v in bm.verts if not v.link_faces]
                    if unused:
                        bmesh.ops.delete(bm, geom=unused, context="VERTS")
                    bmesh.ops.dissolve_limit(bm, angle_limit=.001, verts=list(bm.verts), edges=list(bm.edges), use_dissolve_boundaries=False)
                    bmesh.ops.triangulate(bm, faces=list(bm.faces))
                    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
                    # Blender's float hull can retain almost-coplanar slivers after booleans.
                    # Never silently ship an invalid or over-budget collision polyhedron.
                    if invalid_hull(bm, 1e-5 / float(root.get('icd_meters_per_unit', 1))):
                        bm.free()
                        bm = box_bmesh(mesh)
                        kind = "BOX_FALLBACK"
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
                proxy_mesh = bpy.data.meshes.new(owner.name + "_collision")
                bm.to_mesh(proxy_mesh)
            finally:
                if bm is not None:
                    bm.free()
                bpy.data.meshes.remove(mesh)
            proxy = bpy.data.objects.new(owner.name + "_collision", proxy_mesh)
            root.users_collection[0].objects.link(proxy)
            proxy["icd_role"] = "COLLIDER"
            proxy["icd_proxy_kind"] = kind
            pending.append((owner, proxy))
        # Commit only after every proxy has been built successfully.
        for owner in owners:
            for old in list(owner.children):
                if old.get("icd_role") == "COLLIDER":
                    remove_owned(old)
        for owner, proxy in pending:
            proxy.parent = owner
            proxy.matrix_local = Matrix.Identity(4)
            proxy.display_type = "WIRE"
            proxy.show_in_front = True
    except Exception:
        for owner, proxy in pending:
            remove_owned(proxy)
        raise
    set_view(root)


def validate(root):
    errors, warnings = [], []
    s = root.icd_settings
    pieces, intact = objects(root, "PIECE"), objects(root, "INTACT")
    if not s.asset_id or s.asset_id != slug(s.asset_id):
        errors.append("Asset ID must use lowercase letters, digits and underscores")
    if not intact or not pieces:
        errors.append("Both intact geometry and broken pieces are required")
    if root.parent or any(abs(v - 1) > 1e-5 for v in root.scale):
        errors.append("Asset root must be unparented with scale 1; resize source geometry before Create Asset")
    physical = [p for p in pieces if p.icd_piece.mode != "COSMETIC"]
    dynamic = [p for p in physical if p.icd_piece.mode == "DYNAMIC"]
    if len(dynamic) > s.body_budget:
        errors.append("%d dynamic pieces exceed this asset's budget of %d; group pieces or mark small ones Cosmetic" % (len(dynamic), s.body_budget))
    if not physical:
        errors.append("At least one physical piece is required")
    ids = [p.get("icd_uid") for p in pieces]
    if not all(ids) or len(ids) != len(set(ids)):
        errors.append("Pieces have missing/duplicate IDs; use Refresh Piece IDs after manual separation or duplication")
    for obj in intact + pieces:
        if obj.type != "MESH" or not obj.data.polygons:
            errors.append(obj.name + ": empty or non-mesh geometry")
            continue
        if rest_matrix(obj).to_3x3().determinant() <= 0:
            errors.append(obj.name + ": mirrored/degenerate transform; apply it before authoring")
        if obj.get("icd_role") == "PIECE" and not obj.icd_piece.section.strip():
            errors.append(obj.name + ": section label is empty")
        needs = obj in intact or obj.icd_piece.mode != "COSMETIC"
        proxies = [c for c in obj.children if c.get("icd_role") == "COLLIDER"]
        if needs and len(proxies) != 1:
            errors.append(obj.name + ": generate exactly one collision proxy")
        for proxy in proxies if needs else []:
            if proxy.get("icd_proxy_kind") == "BOX_FALLBACK":
                warnings.append(obj.name + ": hull was invalid/over budget; an enclosing box was generated instead")
            if proxy.modifiers:
                errors.append(obj.name + ": apply collision proxy modifiers before export")
            if abs(proxy.matrix_local.to_3x3().determinant()) < 1e-9:
                errors.append(obj.name + ": collision proxy has a degenerate transform")
            bm = bmesh.new()
            try:
                bm.from_mesh(proxy.data)
                bm.normal_update()
                if len(bm.verts) > 64:
                    errors.append(obj.name + ": collider exceeds 64 vertices; use Box or simplify the proxy")
                if not bm.faces or not all(e.is_manifold for e in bm.edges):
                    errors.append(obj.name + ": collider is not a closed volume")
                elif abs(bm.calc_volume()) < 1e-9:
                    errors.append(obj.name + ": collider has zero volume")
                elif any(f.normal.dot(v.co - f.verts[0].co) > 1e-5 / float(root.get('icd_meters_per_unit', 1)) for f in bm.faces for v in bm.verts):
                    errors.append(obj.name + ": collider must be convex with outward normals")
            finally:
                bm.free()
        if obj.data.shape_keys or obj.find_armature():
            errors.append(obj.name + ": use static geometry without shape keys or armatures")
        if obj.modifiers:
            errors.append(obj.name + ": apply modifiers before export so render and collision geometry agree")
        if obj.data.materials and any(m is None for m in obj.data.materials):
            warnings.append(obj.name + ": an empty material slot will export a default material")
    triangles = sum(sum(max(0, len(p.vertices) - 2) for p in o.data.polygons) for o in pieces)
    if triangles > 15000:
        warnings.append("Broken geometry has %d triangles; inspect its rendering cost" % triangles)
    if len(pieces) > 64 and 'masonry_units' not in root:
        warnings.append("Many render pieces; cosmetic pieces still have a rendering cost")
    if s.break_mode == "SECTIONS" and len({p.icd_piece.section for p in pieces}) < 2:
        warnings.append("Sectioned asset has only one section label")
    return errors, warnings
