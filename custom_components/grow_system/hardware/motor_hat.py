"""Read-only discovery for PCA9685 based motor HATs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class MotorHat:
    address: int
    mode1: int
    prescale: int

    @property
    def channels(self) -> list[dict]:
        """Waveshare Motor Driver HAT channel layout from the vendor driver."""
        return [
            {"id": "A", "name": "Motor A", "pwm": 0, "direction": [1, 2]},
            {"id": "B", "name": "Motor B", "pwm": 5, "direction": [3, 4]},
        ]


class MotorHatInventory:
    """Inspect HAT controller registers without writing or moving motors."""

    def __init__(self, bus_number: int = 1) -> None:
        from smbus2 import SMBus

        self._bus = SMBus(bus_number)

    def close(self) -> None:
        self._bus.close()

    def discover(self, addresses=range(0x40, 0x50)) -> list[MotorHat]:
        hats = []
        for address in addresses:
            try:
                mode1 = self._bus.read_byte_data(address, 0x00)
                prescale = self._bus.read_byte_data(address, 0xFE)
            except OSError:
                continue
            hats.append(MotorHat(address, mode1, prescale))
        return hats
