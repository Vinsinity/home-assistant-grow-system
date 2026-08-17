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

    def read_byte_data(self, address, register):
        self.reads.append((address, register))
        if address != 0x40:
            raise OSError
        return 0x11 if register == 0 else 0x1E

    def close(self):
        pass


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


if __name__ == "__main__":
    unittest.main()
