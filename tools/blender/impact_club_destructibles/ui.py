# SPDX-License-Identifier: GPL-3.0-or-later
import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, FloatVectorProperty, IntProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup
from bpy_extras.io_utils import ExportHelper

from . import core, exporter


def active_root(context):
    return core.root_for(context.active_object) or context.scene.icd_active_asset


def view_changed(self, context):
    root = self.id_data
    if root.get("icd_role") == "ROOT":
        core.set_view(root)


def preview_changed(self, context):
    root = self.id_data
    if root.get("icd_role") == "ROOT":
        core.preview(root)


def structure_material_items(self, context):
    from .structure_parts import profiles
    try:
        data, _ = profiles()
        return [(key, key.replace('_', ' ').title(), '') for key in data['materials'] if key in ('brick', 'stone_rubble', 'stone_dressed', 'oak', 'glass', 'clay_tile')]
    except (OSError, ValueError):
        return []


class ICDAssetSettings(PropertyGroup):
    masonry_input: EnumProperty(name="Unit input", items=[('EXISTING','Bisect existing wall','Preserves modeled wall/opening geometry'),('NEW','Geometry Nodes wall','Rectangular wall regions only')])
    brick_size: FloatVectorProperty(name="Brick size", size=3, default=(.24,.09,.11), min=.01, subtype='XYZ')
    masonry_courses: BoolProperty(name='Coursed stone blocks', default=False)
    masonry_fieldstones: BoolProperty(name='Rounded fieldstone units', default=False)
    facade_enabled: BoolProperty(name='Revealing facade',default=False)
    facade_thickness: FloatProperty(name='Facade thickness',default=.015,min=.002,max=.05,unit='LENGTH')
    facade_shard_size: FloatProperty(name='Facade shard size',default=.3,min=.12,max=.8,unit='LENGTH')
    facade_border: IntProperty(name='Crack spread (shard rings)',default=2,min=0,max=2)
    stone_irregularity: FloatProperty(name='Stone irregularity',default=.85,min=0,max=1,subtype='FACTOR')
    stone_size: FloatVectorProperty(name='Stone size (length / course / depth)',size=3,default=(.45,.25,.3),min=.03,subtype='XYZ')
    stone_length_variation: FloatProperty(name='Length variation',default=.3,min=0,max=.6,subtype='FACTOR')
    stone_bevel: FloatProperty(name='Edge roundness',default=.004,min=0,max=.08,unit='LENGTH')
    mortar_gap: FloatProperty(name="Mortar gap", default=.006, min=0, max=.03)
    border_detail: FloatProperty(name="Border detail", default=.12, min=0, max=1)
    units_per_chunk: IntProperty(name="Units per chunk", default=18, min=1, max=128)
    cluster_p: FloatProperty(name="Metric p", default=1, min=1, max=12)
    course_weight: FloatProperty(name="Course weight", default=1, min=.1, max=10)
    cluster_warp: FloatProperty(name="Warp amount", default=.3, min=0, max=3)
    cluster_frequency: FloatProperty(name="Warp frequency", default=.2, min=.01, max=2)
    cluster_rotation: FloatProperty(name="Seed rotation", default=.12, min=0, max=3.14, subtype='ANGLE')
    cluster_stretch: FloatProperty(name="Seed stretch", default=1.2, min=1, max=3)
    cluster_jitter: FloatProperty(name="Unit jitter", default=.12, min=0, max=1)
    masonry_advanced: BoolProperty(name="Advanced cluster shape", default=False)
    structure_mode: BoolProperty(name="Structure part", default=False)
    structure_type: StringProperty(name="Type", default="wall.straight")
    structure_material: EnumProperty(name="Material profile", items=structure_material_items)
    structure_variant: IntProperty(name="Variant", min=0, default=0)
    structure_grain: EnumProperty(name="Grain axis", items=[('X','X',''),('Y','Y',''),('Z','Z','')], default='X')
    asset_id: StringProperty(name="Asset ID", default="destructible")
    source_note: StringProperty(name="Source note", description="Optional source model/provenance reference")
    material: EnumProperty(name="Material", items=[(x, x.title(), "") for x in core.PRESETS], default="WOOD")
    anchoring: EnumProperty(name="Intact support", items=[("LOOSE", "Loose", "Can move while intact"), ("ANCHORED", "Anchored", "Fixed until broken")])
    break_mode: EnumProperty(name="Breakup", items=[("FULL", "Whole Object", "Release all pieces on break"), ("SECTIONS", "By Section", "Independent authored section labels; no automatic structural graph")])
    mass: FloatProperty(name="Total mass (kg)", min=.001, default=3)
    break_energy: FloatProperty(name="Break threshold (J)", min=.001, default=8, description="Gameplay tuning value; not a material engineering measurement")
    friction: FloatProperty(name="Friction", min=0, max=1, default=.35)
    restitution: FloatProperty(name="Bounce", min=0, max=1, default=.12)
    fx_profile: StringProperty(name="Effects profile", default="wood", description="Reference name only; effects are supplied by the game")
    body_budget: IntProperty(name="Dynamic piece budget", min=1, max=512, default=16)
    collider_style: EnumProperty(name="Proxy shape", items=[("BOX", "Box", "Cheap convex box per part"), ("HULL", "Convex Hull", "Fit a convex hull; validate the vertex budget")])
    cell_count: IntProperty(name="Cells", min=2, max=64, default=12)
    seed: IntProperty(name="Seed", min=0, default=1)
    interior_color: FloatVectorProperty(name="Interior", subtype="COLOR", size=4, min=0, max=1, default=(.35, .19, .08, 1))
    view: EnumProperty(name="Show", items=[("INTACT", "Intact", ""), ("PIECES", "Pieces", "")], update=view_changed)
    show_colliders: BoolProperty(name="Show collision proxies", update=view_changed)
    preview: FloatProperty(name="Explode preview", min=0, max=5, default=0, update=preview_changed, description="Inspection only; export always uses assembled transforms")


class ICDPieceSettings(PropertyGroup):
    mode: EnumProperty(name="Piece behaviour", items=[("DYNAMIC", "Dynamic", "Physical fragment"), ("ANCHORED", "Anchored", "Remains fixed after breakup"), ("COSMETIC", "Cosmetic", "Visual only; no rigid body")])
    section: StringProperty(name="Section", default="body", description="Pieces with the same label belong to one authored break section")
    mass_weight: FloatProperty(name="Mass multiplier", min=.001, default=1, description="Relative to proxy volume; total physical piece mass stays equal to asset mass")


class ICDOperation:
    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and active_root(context) is not None

    def run(self, context):
        raise NotImplementedError

    def execute(self, context):
        try:
            self.run(context)
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class ICD_OT_create(Operator):
    bl_idname = "icd.create_asset"
    bl_label = "Create Asset from Selection"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and any(o.type == "MESH" for o in context.selected_objects)

    def execute(self, context):
        try:
            core.create_asset(context)
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        return {"FINISHED"}


class ICD_OT_separate(ICDOperation, Operator):
    bl_idname = "icd.separate_parts"
    bl_label = "Build Pieces from Mesh Islands"
    bl_options = {"REGISTER", "UNDO"}
    islands: BoolProperty(default=True, options={"HIDDEN"})

    def run(self, context):
        parts = core.separate_parts(context, active_root(context), self.islands)
        self.report({"INFO"}, "%d pieces created; inspect small islands before making colliders" % len(parts))


class ICD_OT_fracture(ICDOperation, Operator):
    bl_idname = "icd.voronoi_fracture"
    bl_label = "Build Voronoi Pieces"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        parts = core.fracture(context, active_root(context))
        self.report({"INFO"}, "%d fracture pieces created" % len(parts))


class ICD_OT_new_brick_wall(Operator):
    bl_idname = 'icd.new_brick_wall'
    bl_label = 'New Brick Wall (Geometry Nodes)'
    bl_options = {'REGISTER','UNDO'}
    width: FloatProperty(name='Width',default=1,min=1,unit='LENGTH')
    height: FloatProperty(name='Height',default=3,min=2.5,unit='LENGTH')
    depth: FloatProperty(name='Thickness',default=.11,min=.03,unit='LENGTH')
    window: BoolProperty(name='0.9 × 1.2 m window + lintel',default=False)

    def invoke(self,context,event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self,context):
        from . import masonry
        try:
            if abs(context.scene.unit_settings.scale_length-1)>1e-8:
                raise ValueError('New masonry walls require metre scene scale')
            root=masonry.new_wall(context,self.width,self.height,self.depth,self.window)
            root.icd_settings.asset_id='brick_window' if self.window else 'brick_wall'
            if bpy.ops.icd.build_structure_part() != {'FINISHED'}:return {'CANCELLED'}
        except ValueError as error:
            self.report({'ERROR'},str(error));return {'CANCELLED'}
        return {'FINISHED'}


class ICD_OT_new_stone_wall(Operator):
    bl_idname='icd.new_stone_wall'
    bl_label='New Stone Block Wall (Geometry Nodes)'
    bl_options={'REGISTER','UNDO'}
    width: FloatProperty(name='Width',default=2,min=1,unit='LENGTH')
    height: FloatProperty(name='Height',default=3,min=2.5,unit='LENGTH')
    depth: FloatProperty(name='Thickness',default=.3,min=.03,unit='LENGTH')
    window: BoolProperty(name='0.9 × 1.2 m window + lintel',default=False)
    rounded: BoolProperty(name='Rounded fieldstones',default=False)

    def invoke(self,context,event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self,context):
        from . import masonry
        try:
            if abs(context.scene.unit_settings.scale_length-1)>1e-8:raise ValueError('New masonry walls require metre scene scale')
            root=masonry.new_wall(context,self.width,self.height,self.depth,self.window,material='stone_rubble' if self.rounded else 'stone_dressed')
            root.icd_settings.asset_id=('fieldstone' if self.rounded else 'stone')+('_window' if self.window else '_wall')
            if bpy.ops.icd.build_structure_part()!={'FINISHED'}:return {'CANCELLED'}
        except ValueError as error:
            self.report({'ERROR'},str(error));return {'CANCELLED'}
        return {'FINISHED'}


class ICD_OT_structure(ICDOperation, Operator):
    bl_idname = "icd.build_structure_part"
    bl_label = "Build Profile Pieces + Atlas"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        from pathlib import Path
        from . import structure_parts
        root = active_root(context)
        settings = root.icd_settings
        grain = {'X': (1,0,0), 'Y': (0,1,0), 'Z': (0,0,1)}[settings.structure_grain]
        structure_parts.tag(root, settings.structure_type, settings.structure_material, settings.structure_variant, settings.seed, grain)
        structure_parts.build(context, root)
        import os
        repository_atlas = Path(__file__).resolve().parents[3] / 'assets/structures/atlas.png'
        atlas_path = Path(os.environ.get('ICD_STRUCTURE_ATLAS', repository_atlas if repository_atlas.is_file() else Path(__file__).resolve().parent / 'data/atlas.png'))
        if not atlas_path.is_file():
            raise ValueError('Run create_farmhouse_parts.py once to generate the shared atlas')
        image = bpy.data.images.get('structure_atlas') or bpy.data.images.load(str(atlas_path), check_existing=True)
        image.name = 'structure_atlas'
        structure_parts.assign_uvs(root, image)
        core.generate_colliders(context, root)
        self.report({'INFO'}, 'Profile pieces, atlas UVs and colliders created; inspect before export')


class ICD_OT_add_parts(ICDOperation, Operator):
    bl_idname = "icd.add_authored_pieces"
    bl_label = "Copy Selected Meshes as Pieces"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        core.add_authored_pieces(context, active_root(context))


class ICD_OT_ids(ICDOperation, Operator):
    bl_idname = "icd.refresh_piece_ids"
    bl_label = "Refresh Piece IDs"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        core.refresh_piece_ids(active_root(context))


class ICD_OT_colliders(ICDOperation, Operator):
    bl_idname = "icd.generate_colliders"
    bl_label = "Generate Collision Proxies"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        root = active_root(context)
        core.generate_colliders(context, root)
        count = sum(o.get("icd_proxy_kind") == "BOX_FALLBACK" for o in core.objects(root, "COLLIDER"))
        if count:
            self.report({"WARNING"}, "%d invalid/over-budget hulls replaced by enclosing boxes; inspect the proxies" % count)


class ICD_OT_preset(ICDOperation, Operator):
    bl_idname = "icd.apply_material_preset"
    bl_label = "Apply Material Defaults"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        s = active_root(context).icd_settings
        s.mass, s.break_energy, s.friction, s.restitution, s.fx_profile = core.PRESETS[s.material]


class ICD_OT_assign(ICDOperation, Operator):
    bl_idname = "icd.assign_selected_pieces"
    bl_label = "Apply Active Piece Settings to Selected"
    bl_options = {"REGISTER", "UNDO"}

    def run(self, context):
        obj = context.active_object
        if not obj or obj.get("icd_role") != "PIECE":
            raise ValueError("Make a piece active first")
        root, p = core.root_for(obj), obj.icd_piece
        for selected in context.selected_objects:
            if selected.get("icd_role") == "PIECE" and core.root_for(selected) == root:
                selected.icd_piece.mode = p.mode
                selected.icd_piece.section = p.section
                selected.icd_piece.mass_weight = p.mass_weight


class ICD_OT_validate(ICDOperation, Operator):
    bl_idname = "icd.validate_asset"
    bl_label = "Validate Asset"

    def run(self, context):
        root = active_root(context)
        errors, warnings = core.validate(root)
        if not errors and 'structure_part' in root:
            from . import structure_parts
            try:
                meters = float(root.get('icd_meters_per_unit', 1))
                volumes = {p: exporter.collider(p, meters)[1] for p in core.objects(root, 'PIECE')}
                structure_parts.metadata(root, meters, volumes)
            except ValueError as error:
                errors.append(str(error))
        lines = (["ERROR: " + x for x in errors] + ["WARNING: " + x for x in warnings]) or ["Ready to export"]
        name = "ICD Validation - " + root.icd_settings.asset_id
        text = bpy.data.texts.get(name) or bpy.data.texts.new(name)
        text.clear()
        text.write("\n".join(lines))
        if errors:
            raise ValueError("; ".join(errors[:3]) + (" (see validation Text datablock)" if len(errors) > 3 else ""))
        self.report({"WARNING"} if warnings else {"INFO"}, "; ".join(warnings) if warnings else "Ready to export")


class ICD_OT_export(Operator, ExportHelper):
    bl_idname = "icd.export_asset"
    bl_label = "Export Destructible"
    filename_ext = ".glb"
    filter_glob: StringProperty(default="*.glb", options={"HIDDEN"})
    overwrite: BoolProperty(name="Replace Existing Files", default=False, description="Replace both the GLB and its destructible JSON definition")

    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and active_root(context) is not None

    def invoke(self, context, event):
        if not self.filepath:
            self.filepath = active_root(context).icd_settings.asset_id + ".glb"
        return ExportHelper.invoke(self, context, event)

    def execute(self, context):
        try:
            manifest, warnings = exporter.export_asset(context, active_root(context), self.filepath, self.overwrite)
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report({"INFO"}, "Exported %s: %d pieces, GLB + JSON%s" % (manifest["assetId"], len(manifest["pieces"]), " (validation warnings; review asset)" if warnings else ""))
        return {"FINISHED"}


class ICD_PT_author(Panel):
    bl_label = "Destruction Author"
    bl_idname = "ICD_PT_author"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Impact Club"

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.operator("icd.create_asset", icon="DUPLICATE")
        layout.operator('icd.new_brick_wall')
        layout.operator('icd.new_stone_wall')
        layout.operator('icd.new_stone_wall',text='New Rounded Stone Wall').rounded=True
        layout.prop(context.scene, "icd_active_asset", text="Asset")
        root = active_root(context)
        if not root:
            layout.label(text="Select source prop meshes to begin.")
            return
        s = root.icd_settings
        box = layout.box()
        box.prop(s, "asset_id")
        box.prop(s, "structure_mode")
        if s.structure_mode:
            box.prop(s, "structure_type")
            box.prop(s, "structure_material")
            box.prop(s, "structure_variant")
            box.prop(s, "structure_grain")
            box.prop(s, "seed")
            if s.structure_material=='stone_dressed':box.prop(s,'masonry_courses')
            if s.structure_material=='stone_rubble':box.prop(s,'masonry_fieldstones')
            if s.structure_material == 'brick' or s.structure_material=='stone_dressed' and s.masonry_courses or s.structure_material=='stone_rubble' and s.masonry_fieldstones:
                if not (s.structure_material=='stone_rubble' and s.masonry_fieldstones):box.prop(s,'masonry_input')
                if s.structure_material=='stone_rubble':
                    for key in ('stone_size','stone_irregularity','stone_bevel'):box.prop(s,key)
                elif s.structure_material=='stone_dressed':
                    for key in ('stone_size','stone_length_variation','stone_bevel'):box.prop(s,key)
                else:box.prop(s,'brick_size')
                for key in ('mortar_gap','units_per_chunk','border_detail','masonry_advanced'):
                    box.prop(s,key)
                box.prop(s,'facade_enabled')
                if s.facade_enabled:
                    box.prop(s,'facade_thickness');box.prop(s,'facade_shard_size')
                    if s.masonry_advanced:box.prop(s,'facade_border')
                if s.masonry_advanced:
                    for key in ('cluster_p','course_weight','cluster_warp','cluster_frequency','cluster_rotation','cluster_stretch','cluster_jitter'):
                        box.prop(s,key)
            box.operator("icd.build_structure_part")
        if not s.structure_mode:
            box.prop(s, "material", text="Legacy material")
            box.operator("icd.apply_material_preset")
            box.prop(s, "anchoring")
            box.prop(s, "break_mode")
            box.prop(s, "mass")
            box.prop(s, "break_energy")
            row = box.row(align=True)
            row.prop(s, "friction")
            row.prop(s, "restitution")
            box.prop(s, "fx_profile")
            box.prop(s, "source_note")
            box = layout.box()
            box.label(text="Build / Replace Pieces", icon="MESH_DATA")
            box.operator("icd.separate_parts", text="Separate Mesh Islands").islands = True
            box.operator("icd.separate_parts", text="One Piece per Source Object").islands = False
            box.operator("icd.add_authored_pieces")
            box.operator("icd.refresh_piece_ids")
            box.prop(s, "cell_count")
            box.prop(s, "seed")
            box.prop(s, "interior_color")
            box.operator("icd.voronoi_fracture")
        piece = context.active_object
        if piece and piece.get("icd_role") == "PIECE":
            box = layout.box()
            box.label(text="Selected Piece: " + piece.name)
            box.prop(piece.icd_piece, "mode")
            box.prop(piece.icd_piece, "section")
            box.prop(piece.icd_piece, "mass_weight")
            box.operator("icd.assign_selected_pieces")
        box = layout.box()
        box.prop(s, "collider_style")
        box.prop(s, "body_budget")
        box.operator("icd.generate_colliders")
        box.prop(s, "view", expand=True)
        box.prop(s, "show_colliders")
        box.prop(s, "preview")
        parts = core.objects(root, "PIECE")
        box.label(text="%d pieces / %d dynamic" % (len(parts), sum(p.icd_piece.mode == "DYNAMIC" for p in parts)))
        layout.operator("icd.validate_asset", icon="CHECKMARK")
        layout.operator("icd.export_asset", icon="EXPORT")


CLASSES = (ICDAssetSettings, ICDPieceSettings, ICD_OT_create, ICD_OT_separate, ICD_OT_fracture, ICD_OT_new_brick_wall, ICD_OT_new_stone_wall, ICD_OT_structure, ICD_OT_add_parts, ICD_OT_ids, ICD_OT_colliders, ICD_OT_preset, ICD_OT_assign, ICD_OT_validate, ICD_OT_export, ICD_PT_author)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Object.icd_settings = PointerProperty(type=ICDAssetSettings)
    bpy.types.Object.icd_piece = PointerProperty(type=ICDPieceSettings)
    bpy.types.Scene.icd_active_asset = PointerProperty(type=bpy.types.Object, poll=lambda self, obj: obj.get("icd_role") == "ROOT")


def unregister():
    del bpy.types.Scene.icd_active_asset
    del bpy.types.Object.icd_piece
    del bpy.types.Object.icd_settings
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
