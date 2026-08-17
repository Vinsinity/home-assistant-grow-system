"""Tests for read-only PCA9685 Motor HAT inventory."""

import importlib.util
from pathlib import Path
import sys
import unittest

MODULE = Path(__file__).parents[1] / "custom_components/grow_system/hardware/motor_hat.py"
SPEC = importlib.util.spec_from_file_location("motor_hat", MODULE)
motor_hat = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = motor_hat
SPEC.loader.exec_module(motor_hat)


class FakeBus:
    def __init__(self):
        self.reads = []
        self.byte_writes = []
        self.block_writes = []

    def read_byte_data(self, address, register):
        self.reads.append((address, register))
        if address != 0x40:
            raise OSError
        return 0x11 if register == 0 else 0x1E

    def close(self):
        pass

    def write_byte_data(self, address, register, value):
        self.byte_writes.append((address, register, value))

    def write_i2c_block_data(self, address, register, values):
        self.block_writes.append((address, register, values))


class MotorHatInventoryTest(unittest.TestCase):
    def test_discovery_only_reads_registers(self):
        inventory = object.__new__(motor_hat.MotorHatInventory)
        inventory._bus = FakeBus()
        hats = inventory.discover([0x40, 0x41])
        self.assertEqual([0x40], [hat.address for hat in hats])
        self.assertEqual(
            [
                {"id": "A", "name": "Motor A", "pwm": 0, "direction": [1, 2]},
                {"id": "B", "name": "Motor B", "pwm": 5, "direction": [3, 4]},
            ],
            hats[0].channels,
        )
        self.assertEqual([(0x40, 0), (0x40, 0xFE), (0x41, 0)], inventory._bus.reads)

    def test_guarded_motor_run_sets_vendor_channels_and_stops(self):
        bus = FakeBus()
        controller = motor_hat.WaveshareMotorHatController(address=0x40, bus=bus)
        original_sleep = motor_hat.time.sleep
        motor_hat.time.sleep = lambda _seconds: None
        try:
            controller.timed_run("A", 5, 100)
        finally:
            motor_hat.time.sleep = original_sleep
        self.assertIn((0x40, 0x06 + 4 * 2, [0, 0, 255, 15]), bus.block_writes)
        self.assertIn((0x40, 0x06 + 4 * 0, [0, 0, 255, 15]), bus.block_writes)
        self.assertEqual((0x40, 0x06 + 4 * 2, [0, 0, 0, 0]), bus.block_writes[-1])

    def test_motor_run_rejects_unbounded_duration(self):
        controller = motor_hat.WaveshareMotorHatController(address=0x40, bus=FakeBus())
        with self.assertRaises(ValueError):
            controller.timed_run("A", 31, 100)


if __name__ == "__main__":
    unittest.main()
