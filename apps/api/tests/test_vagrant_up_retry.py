"""Regression for `_vagrant_up_argv`'s retry on the known vagrant-vmware-desktop
boot-SSH flake.

Reproduced live this session: `siem`'s `vagrant up` hit "The SSH connection
was unexpectedly closed by the remote end... Configuring network adapters
within the VM" and exited non-zero, while every VM (including `siem`) was
actually running moments later per `vmrun list`. `_vagrant_up_argv` builds a
self-contained script (run by the generic build shim, not this test process)
that watches for that exact signature and retries `vagrant up <host>` for
just the affected machine.

This test executes the generated script's source directly (not as a real
subprocess) with `subprocess.Popen`/`subprocess.call` swapped out for fakes,
so it exercises the exact logic shipped to production without needing a
real `vagrant` binary.
"""

from __future__ import annotations

import sys
import types

import pytest

from labforge_core.services import build_runner


class _FakeProc:
    def __init__(self, lines: list[str], returncode: int) -> None:
        self.stdout = iter(lines)
        self.returncode = returncode

    def wait(self) -> int:
        return self.returncode


def _run_script(script: str, popen, on_call=None) -> int:
    fake_subprocess = types.SimpleNamespace(
        Popen=popen,
        call=(lambda a, **k: (on_call(a) if on_call else None) or 0),
        PIPE=-1,
        STDOUT=-2,
    )
    ns: dict[str, object] = {"__name__": "__vagrant_up_argv_test__"}
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "subprocess":
            return fake_subprocess
        return real_import(name, *a, **kw)

    builtins.__import__ = fake_import
    try:
        with pytest.raises(SystemExit) as exc:
            exec(compile(script, "<vagrant_up_argv>", "exec"), ns)
    finally:
        builtins.__import__ = real_import
    code = exc.value.code
    assert isinstance(code, int)
    return code


def test_retries_only_the_host_that_hit_the_known_flake():
    calls: list[list[str]] = []
    responses = [
        _FakeProc(
            [
                "==> siem: Configuring network adapters within the VM...\n",
                "The SSH connection was unexpectedly closed by the remote end.\n",
            ],
            1,
        ),
        _FakeProc(["==> siem: Machine booted and ready!\n"], 0),
    ]

    def fake_popen(argv, **kw):
        calls.append(list(argv))
        return responses.pop(0)

    argv = build_runner._vagrant_up_argv(["vagrant", "up"], recover_hosts=[])
    assert argv[0] == sys.executable
    rc = _run_script(argv[2], fake_popen)

    assert rc == 0
    assert calls == [["vagrant", "up"], ["vagrant", "up", "siem"]]


def test_unrelated_failure_is_not_retried():
    calls: list[list[str]] = []
    responses = [_FakeProc(["==> ap-target: some other real error\n"], 1)]

    def fake_popen(argv, **kw):
        calls.append(list(argv))
        return responses.pop(0)

    argv = build_runner._vagrant_up_argv(["vagrant", "up"], recover_hosts=[])
    rc = _run_script(argv[2], fake_popen)

    assert rc == 1
    assert calls == [["vagrant", "up"]]  # no retry attempted


def test_recover_hosts_are_provisioned_after_a_clean_up():
    responses = [_FakeProc(["==> ap-second: Machine booted and ready!\n"], 0)]
    provisioned: list[list[str]] = []

    def fake_popen(argv, **kw):
        return responses.pop(0)

    argv = build_runner._vagrant_up_argv(["vagrant", "up"], recover_hosts=["ap-second"])
    rc = _run_script(argv[2], fake_popen, on_call=lambda a: provisioned.append(list(a)))

    assert rc == 0
    assert provisioned == [["vagrant", "provision", "ap-second", "--provision-with", "usb-radio-recover"]]
