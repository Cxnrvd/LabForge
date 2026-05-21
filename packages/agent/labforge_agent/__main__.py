"""Allow ``python -m labforge_agent`` to invoke the CLI (used by daemon spawn)."""

from labforge_agent.cli import app

if __name__ == "__main__":
    app()
