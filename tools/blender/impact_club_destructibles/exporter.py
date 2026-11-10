# SPDX-License-Identifier: GPL-3.0-or-later
"""GLB nodes and physics data share the same assembled, metre-scale Y-up frame."""
import json
import os
from pathlib import Path
import tempfile

import bpy
import bmesh
from mathutils import Matrix, Vector

from . import core

# Blender Z-up -> glTF Y-up, matching export_yup=True (right-handed).
AXIS = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))


def vec(value):
    return [round(float(x), 8) for x in value]


def collider(owner, meters):
    proxy = next(c for c in owner.children if c.get("icd_role") == "COLLIDER")
    part = core.rest_matrix(owner)
    origin = part.translation
    transform = part @ proxy.matrix_local
    mesh = proxy.data
    vertices = [vec(AXIS @ ((transform @ v.co - origin) * meters)) for v in mesh.vertices]
    faces = [list(p.vertices) for p in mesh.polygons]
    # Negative proxy scaling reverses winding. Owner negatives are rejected by validation.
    if transform.to_3x3().determinant() < 0:
        faces = [f[::-1] for f in faces]
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        volume = abs(bm.calc_volume() * transform.to_3x3().determinant()) * meters ** 3
    finally:
        bm.free()
    return {"type": "convex", "authorShape": proxy.get("icd_proxy_kind", "CUSTOM"), "vertices": vertices, "faces": faces}, max(volume, 1e-9)


def export_asset(context, root, filepath, overwrite=False):
    context.view_layer.update()
    errors, warnings = core.validate(root)
    if errors:
        raise ValueError("; ".join(errors))
    destination = Path(bpy.path.abspath(filepath)).resolve().with_suffix(".glb")
    definition = destination.with_suffix(".destructible.json")
    if not overwrite and (destination.exists() or definition.exists()):
        raise ValueError("An export already exists. Enable Replace Existing Files, or choose another filename")
    if not destination.parent.is_dir():
        raise ValueError("Choose an existing export directory")
    s = root.icd_settings
    meters = float(root.get("icd_meters_per_unit", 1.0))
    if meters <= 0:
        raise ValueError("Invalid unit scale")
    intact, pieces = core.objects(root, "INTACT"), core.objects(root, "PIECE")
    volumes = {}
    shapes = {}
    for obj in intact + pieces:
        if obj in pieces and obj.icd_piece.mode == "COSMETIC":
            continue
        shapes[obj], volume = collider(obj, meters)
        if obj in pieces:
            volumes[obj] = volume * obj.icd_piece.mass_weight
    total = sum(volumes.values())
    part_metadata = None
    if "structure_part" in root:
        from . import structure_parts
        part_metadata = structure_parts.metadata(root, meters, volumes)
    selected = list(context.selected_objects)
    active = context.view_layer.objects.active
    scene = context.scene
    export_collection = bpy.data.collections.new("ICD_export_temporary")
    scene.collection.children.link(export_collection)
    temp_root = bpy.data.objects.new(s.asset_id, None)
    export_collection.objects.link(temp_root)
    temp_root["icd_schema"] = "impact-club.destructible"
    temp_root["icd_version"] = 1
    temp_root["icd_asset_id"] = s.asset_id
    nodes = {}
    manifest = {
        "schema": "impact-club.destructible", "version": 1,
        "assetId": s.asset_id, "model": destination.name, "units": "m", "upAxis": "Y",
        "material": s.material.lower(), "anchoring": s.anchoring.lower(),
        "breakMode": s.break_mode.lower(), "massKg": s.mass,
        "breakEnergyJ": s.break_energy, "friction": s.friction, "restitution": s.restitution,
        "fxProfile": s.fx_profile, "sourceNote": s.source_note,
        "intact": {"nodes": [], "colliders": []}, "pieces": [],
    }
    if part_metadata:
        manifest.update(part_metadata)
        temp_root["icd_version"] = 2
        temp_root["material_id"] = part_metadata["material"]
        temp_root["part_type"] = part_metadata["part"]["type"]
        temp_root["structure"] = json.dumps(part_metadata, separators=(",", ":"))
    try:
        for i, obj in enumerate(intact + pieces):
            role = obj["icd_role"].lower()
            node_name = "%s_%s_%03d" % (s.asset_id, role, i)
            mesh = obj.data.copy()
            part = core.rest_matrix(obj)
            origin = part.translation.copy()
            # Bake rotation/scale into vertices, preserving UVs and material slots.
            mesh.transform(Matrix.Scale(meters, 4) @ Matrix.Translation(-origin) @ part)
            if part_metadata and not (part_metadata.get('masonry',{}).get('pattern')=='rubble_stone' and role=='piece' and not obj.get('masonry_lintel')):
                # Architectural source regions must not shade like rounded cubes.
                # Keep the same flat face normals in intact and fractured views.
                mesh.shade_flat()
                mesh.update()
                normals = [(0, 0, 0)] * len(mesh.loops)
                for face in mesh.polygons:
                    for loop in face.loop_indices:
                        normals[loop] = tuple(face.normal)
                mesh.normals_split_custom_set(normals)
            elif part_metadata:
                # Rounded fieldstone lighting uses a continuous ellipsoid normal
                # field on its deliberately small, convex silhouette hull.
                mesh.shade_smooth()
                lo=Vector([min(v.co[i] for v in mesh.vertices) for i in range(3)])
                hi=Vector([max(v.co[i] for v in mesh.vertices) for i in range(3)])
                centre=(lo+hi)/2
                radii=[max((hi[i]-lo[i])/2,1e-6) for i in range(3)]
                normals=[]
                for loop in mesh.loops:
                    delta=mesh.vertices[loop.vertex_index].co-centre
                    normal=Vector([delta[i]/(radii[i]*radii[i]) for i in range(3)])
                    normals.append(tuple(normal.normalized()))
                mesh.normals_split_custom_set(normals)
            mesh.update()
            node = bpy.data.objects.new(node_name, mesh)
            export_collection.objects.link(node)
            node.parent = temp_root
            node.location = origin * meters
            node["icd_role"] = role
            nodes[obj] = node
            if obj in intact:
                manifest["intact"]["nodes"].append(node_name)
                manifest["intact"]["colliders"].append({**shapes[obj], "position": vec(AXIS @ (origin * meters))})
            else:
                p = obj.icd_piece
                node["icd_piece_id"] = obj["icd_uid"]
                mass = s.mass * volumes[obj] / total if obj in volumes else 0.0
                manifest["pieces"].append({
                    "id": obj["icd_uid"], "node": node_name, "section": p.section.strip(),
                    "mode": p.mode.lower(), "massKg": mass,
                    "position": vec(AXIS @ (origin * meters)), "collider": shapes.get(obj),
                })
        if part_metadata and 'masonry' in part_metadata:
            from . import masonry
            masonry.merge_export_nodes(context, nodes, manifest, part_metadata)
            masonry.export_facade(root,temp_root,export_collection,part_metadata)
        # Joining masonry export copies replaces their objects; use live children.
        core.select_only(context, [temp_root] + list(temp_root.children), temp_root)
        # Stage both files before replacing either destination. Roll back on replacement failure.
        with tempfile.TemporaryDirectory(prefix=".icd_", dir=destination.parent) as staging:
            staged_glb = Path(staging) / destination.name
            staged_json = Path(staging) / definition.name
            result = bpy.ops.export_scene.gltf(
                filepath=str(staged_glb), export_format="GLB", use_selection=True,
                use_visible=False, use_renderable=False, export_yup=True,
                export_extras=True, export_attributes=bool(part_metadata and 'masonry' in part_metadata), export_animations=False, export_cameras=False,
                export_lights=False, export_skins=False, export_morph=False,
                export_materials="EXPORT", export_apply=False,
            )
            if "FINISHED" not in result or not staged_glb.is_file():
                raise ValueError("Blender's GLB exporter did not produce a file")
            staged_json.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            backups = {}
            installed = []
            try:
                for target in (destination, definition):
                    if target.exists():
                        backup = Path(staging) / (target.name + ".backup")
                        os.replace(target, backup)
                        backups[target] = backup
                for source, target in ((staged_glb, destination), (staged_json, definition)):
                    os.replace(source, target)
                    installed.append(target)
            except Exception:
                for target in installed:
                    target.unlink(missing_ok=True)
                for target, backup in backups.items():
                    os.replace(backup, target)
                raise
        return manifest, warnings
    finally:
        for obj in list(export_collection.objects):
            # Delete children via the root once, not from stale references.
            if obj == temp_root:
                core.remove_owned(obj)
                break
        bpy.data.collections.remove(export_collection)
        for obj in context.view_layer.objects:
            obj.select_set(False)
        for obj in selected:
            if obj.name in context.view_layer.objects and not obj.hide_get():
                obj.select_set(True)
        context.view_layer.objects.active = active
