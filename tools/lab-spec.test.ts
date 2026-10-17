import { it } from 'vitest';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
it('specs', () => {
  for (const p of PRESETS) {
    const s = computeVehicleSpec(p);
    const pt = s.powertrain;
    process.stdout.write(`SPEC ${p.id.padEnd(8)} mass ${s.mass.toFixed(1)} bike ${(s.mass - s.riderMass).toFixed(1)} wb ${s.wheelbase.toFixed(3)} peakT ${pt.peakTorque.toFixed(0)} ratio ${pt.totalRatio.toFixed(2)} wheelT ${(pt.peakTorque * pt.totalRatio * 0.97).toFixed(0)} maxP ${(pt.maxPower / 1000).toFixed(1)}kW V ${pt.voltage} kv ${pt.kv} rR ${s.rear.radius.toFixed(3)}\n`);
  }
});
