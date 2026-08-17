"""Tests for the read-only Atlas EZO protocol driver."""

from collections import deque
import importlib.util
from pathlib import Path
import sys
import unittest


MODULE = Path(__file__).parents[1] / "custom_components/grow_system/hardware/atlas_ezo.py"
SPEC = importlib.util.spec_from_file_location("atlas_ezo", MODULE)
atlas_ezo = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = atlas_ezo
SPEC.loader.exec_module(atlas_ezo)


class FakeTransport:
    def __init__(self, responses):
        self.responses = deque(responses)
        self.writes = []

    def write(self, address, payload):
        self.writes.append((address, payload))

    def read(self, address, length):
        return self.responses.popleft()

    def close(self):
        pass


class AtlasEzoBusTest(unittest.TestCase):
    def test_identify(self):
        transport = FakeTransport([b"\x01?I,pH,2.14\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        device = bus.identify(0x63)
        self.assertEqual("pH", device.device_type)
        self.assertEqual("2.14", device.firmware)
        self.assertEqual([(0x63, b"i")], transport.writes)

    def test_pending_response_is_retried(self):
        transport = FakeTransport([b"\xfe", b"\x0119.42\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        device = atlas_ezo.AtlasDevice(0x66, "RTD")
        self.assertEqual((19.42,), bus.read_measurement(device))

    def test_multiple_ec_fields(self):
        transport = FakeTransport([b"\x011234,617,0.65,1.000\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        device = atlas_ezo.AtlasDevice(0x64, "EC")
        self.assertEqual((1234.0, 617.0, 0.65, 1.0), bus.read_measurement(device))

    def test_syntax_error(self):
        transport = FakeTransport([b"\x02"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        with self.assertRaises(atlas_ezo.AtlasProtocolError):
            bus.command(0x63, "bad")

    def test_manual_discovery_addresses(self):
        transport = FakeTransport([b"\x01?I,pH,2.16\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        devices = bus.discover([0x62])
        self.assertEqual(0x62, devices[0].address)
        self.assertEqual([(0x62, b"i")], transport.writes)

    def test_ph_mid_calibration(self):
        transport = FakeTransport([b"\x01\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        device = atlas_ezo.AtlasDevice(0x63, "pH")
        bus.calibrate(device, "mid", 7.0)
        self.assertEqual([(0x63, b"Cal,mid,7")], transport.writes)

    def test_rejects_invalid_calibration(self):
        bus = atlas_ezo.AtlasEzoBus(
            transport=FakeTransport([]), sleep=lambda _: None
        )
        with self.assertRaises(ValueError):
            bus.calibrate(atlas_ezo.AtlasDevice(0x61, "DO"), "mid", 7)

    def test_management_command(self):
        transport = FakeTransport([b"\x01?Status,P,3.30\x00"])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        result = bus.device_command(atlas_ezo.AtlasDevice(0x63, "pH"), "Status")
        self.assertEqual("?Status,P,3.30", result)
        self.assertEqual([(0x63, b"Status")], transport.writes)

    def test_address_change_is_write_only(self):
        transport = FakeTransport([])
        bus = atlas_ezo.AtlasEzoBus(transport=transport, sleep=lambda _: None)
        bus.change_address(atlas_ezo.AtlasDevice(0x63, "pH"), 0x65)
        self.assertEqual([(0x63, b"I2C,101")], transport.writes)

    def test_protected_commands_are_rejected(self):
        bus = atlas_ezo.AtlasEzoBus(transport=FakeTransport([]), sleep=lambda _: None)
        for command in ("Factory", "I2C,101", "Cal,mid,7"):
            with self.assertRaises(ValueError):
                bus.device_command(atlas_ezo.AtlasDevice(0x63, "pH"), command)


if __name__ == "__main__":
    unittest.main()
