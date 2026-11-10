# SPDX-License-Identifier: GPL-3.0-or-later
bl_info = {
    "name": "Impact Club Destruction Author",
    "author": "Impact Club",
    "version": (0, 2, 0),
    "blender": (5, 0, 0),
    "location": "View3D > Sidebar > Impact Club",
    "description": "Author reusable destructibles, preview pieces and export GLB + JSON",
    "category": "Object",
}

from . import ui

def register():
    ui.register()

def unregister():
    ui.unregister()
