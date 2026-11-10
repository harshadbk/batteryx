"""Registry of every engineering model: id, version, fidelity label, equations and assumptions."""
from . import ageing, bms, comparison, configuration, cost, electrical, energy, estimates, mechanical, thermal, variation

MODELS = [m.MODEL for m in (configuration, energy, estimates, electrical, thermal, ageing, bms, mechanical, cost, variation, comparison)]
