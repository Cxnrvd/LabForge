"""Drop-in role-installer plugins.

Each module in this package is auto-imported on backend startup by
``labforge_core.provisioners.role_registry.load_plugins``. Register
roles by calling ``register_linux_role`` / ``register_windows_role``.

Example plugin (``my_org_extras.py``)::

    from labforge_core.provisioners.role_registry import register_linux_role

    register_linux_role(
        role_id="my-edr",
        description="My corporate EDR agent",
        script='''#!/bin/bash
            curl -fsSL https://internal/edr.sh | bash
        ''',
    )
"""
