"""Plugin packages for LabForge.

  * :mod:`labforge_core.plugins.node_types` — per node-type metadata
    (label, default OS, accent colour, icon, role allow-list) the
    validator, generator, and UI consume from one registry.
  * :mod:`labforge_core.provisioners.role_registry` — per-role install
    snippet registry; auto-loads plugins from
    ``labforge_core.provisioners.plugins``.

Together these are the seam future plugins extend.
"""
