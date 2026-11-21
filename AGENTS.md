# Three.js library working rules

- Read the relevant library entry, its configuration and lifecycle, and a working bench sample before choosing an approach. Name the APIs and control panels you will reuse in the pre-edit contract. If a needed capability is missing, identify it and ask before creating a replacement.
- Reuse the tool's existing controls and assets. Bind supported settings to the existing panel builders under `bench/` and use their labels and ranges. Keep demo-specific controls limited to the integration itself.
- Keep standalone tool benches within the dependency rules in `README.md` and `tests/isolation/isolation.test.js`. Mixed demos compose tool APIs and hooks. A request for a demo authorizes demo wiring and registration. Changes to shared tools require a separate request or approval.
- Preserve ownership. Terrain owns its heightfield and surface data, the physics adapter owns collider synchronization, and the host wires character contacts to the terrain, water, and vegetation tools. Reuse those interfaces and their existing implementations.
- Keep settings named and use the tool's defaults where applicable. Keep orchestration, authored layout, assets, and feature logic in focused modules. Do not grow a god class or duplicate a neighboring demo.
- Verify the normal demo entry point and the affected interaction. Report the exact scene or URL, what was observed, and which parts still need a playtest. Keep local-only character assets out of production builds.
