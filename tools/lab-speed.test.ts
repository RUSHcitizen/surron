import { it } from 'vitest';
import { accelTest } from '../src/physics/sim';
import { computeVehicleSpec } from '../src/vehicle/spec';
import { PRESETS } from '../src/vehicle/build';
it('speed lab', () => {
  for (const build of PRESETS) { const p = { build };
    const sp = computeVehicleSpec(p.build);
    for (const mode of ((process.env.MODES ?? 'sport').split(',')) as any) {
      const r = accelTest(sp, 'asphalt', 40, mode);
      process.stdout.write("\n"+[p.build.name, mode, 'top', (r.topSpeed * 3.6).toFixed(0), 'km/h', '0-50', r.t0to50?.toFixed(2), '0-80', r.t0to80?.toFixed(2), 'crashed', r.crashed].join(" "));
    }
  }
});
