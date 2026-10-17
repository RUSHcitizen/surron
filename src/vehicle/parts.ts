/**
 * Parts catalog. Every part carries real physical parameters consumed by
 * `computeVehicleSpec` — nothing here is purely a label. Trade-offs are
 * deliberate: there is no universally "best" part.
 *
 * Units: SI (kg, m, N, N·m, W, Wh, V, K) unless noted.
 */

export interface PartBase {
  id: string;
  name: string;
  desc: string;
  pros: string[];
  cons: string[];
  /** Locked parts are cosmetic only and unlock through local progression. */
  unlock?: string;
}

export interface MotorPart extends PartBase {
  mass: number;
  /** Peak motor-shaft torque, N·m. */
  peakTorque: number;
  /** Continuous-ish rated mechanical power, W (peak is set by controller/battery limits). */
  ratedPower: number;
  /** No-load speed constant, rpm per volt. */
  kv: number;
  /** Fixed primary reduction inside the motor housing / belt stage. */
  primaryRatio: number;
  /** Peak efficiency (0..1). */
  efficiency: number;
  /** Thermal capacity, J/K. */
  thermalMass: number;
  /** Cooling coefficient, W/K at standstill. */
  cooling: number;
  /** Temperature at which power derating starts / reaches minimum, °C. */
  deratingStart: number;
  maxTemp: number;
  /** Audio character: base whine multiplier. */
  whine: number;
}

export interface ControllerPart extends PartBase {
  mass: number;
  /** Fraction of motor peak torque the controller can command (phase current). */
  torqueFactor: number;
  /** Max battery-side power, W. */
  maxPower: number;
  /** Throttle ramp rate, 1/s (how fast commanded torque can rise). */
  rampRate: number;
  /** Maximum regenerative braking torque fraction of motor peak torque. */
  regenMax: number;
  /** Supports electronic traction control / wheelie control. */
  tractionControl: boolean;
  /** Extra motor heating multiplier (aggressive current). */
  heat: number;
  /** PWM switching tone multiplier for audio. */
  pwmTone: number;
}

export interface BatteryPart extends PartBase {
  mass: number;
  voltage: number;
  capacityWh: number;
  /** Max discharge power, W. */
  maxPower: number;
  /** Internal resistance, ohms (voltage sag). */
  resistance: number;
  /** Vertical CoM offset of the pack within the frame bay, m. */
  heightOffset: number;
  /** Visual box size scale. */
  size: number;
}

export type TreadId = 'street' | 'dualsport' | 'knobby' | 'paddle';
export type CompoundId = 'soft' | 'medium' | 'hard';
export type RimStyleId = 'spoke' | 'cast' | 'star' | 'disc';

export interface TreadPart extends PartBase {
  /** Peak friction coefficient by surface. */
  mu: Record<SurfaceId, number>;
  /** Sliding / peak friction ratio. */
  slideRatio: number;
  /** Lateral (cornering) stiffness multiplier, e.g. knobs squirm on tarmac. */
  stiffness: Record<SurfaceId, number>;
  /** Rolling resistance multiplier. */
  rolling: number;
  /** Extra mass per tire, kg. */
  mass: number;
  /** Audio: tire hum roughness 0..1. */
  hum: number;
}

export interface CompoundPart extends PartBase {
  muScale: number;
  slideRatioDelta: number;
  rolling: number;
}

export interface RimStylePart extends PartBase {
  massScale: number;
}

export interface ForkPart extends PartBase {
  mass: number;
  travel: number;
  /** Lower triple clamp to axle at full extension, m. */
  length: number;
  /** Base wheel rate, N/m. */
  springRate: number;
  /** Base damping coefficient, N·s/m (scaled by clicks). */
  damping: number;
  /** Bump-stop / bottom-out progressiveness 0..1 (air chamber ramp). */
  progression: number;
  inverted: boolean;
}

export interface ShockPart extends PartBase {
  mass: number;
  travel: number;
  springRate: number;
  damping: number;
  progression: number;
  /** Raises/lowers the swingarm resting height (ride height), m. */
  rideHeight: number;
}

export interface SwingarmPart extends PartBase {
  mass: number;
  length: number;
}

export interface YokePart extends PartBase {
  /** Rake (steering axis angle from vertical), degrees. */
  rake: number;
  /** Fork offset, m. */
  offset: number;
}

export interface HandlebarPart extends PartBase {
  mass: number;
  rise: number;
  width: number;
  /** Steering leverage multiplier (affects lean rate / low-speed steering). */
  leverage: number;
  /** Rider CoM height change, m. */
  riderHeight: number;
  /** Aero CdA change, m². */
  cda: number;
}

export interface SeatPart extends PartBase {
  mass: number;
  height: number;
  length: number;
}

export interface FenderPart extends PartBase {
  mass: number;
  cda: number;
  style: 'stock' | 'high' | 'short';
}

export interface BodyKitPart extends PartBase {
  mass: number;
  cda: number;
  /** Crash impact tolerance multiplier. */
  toughness: number;
  style: 'stock' | 'race' | 'armor' | 'fairing';
}

export interface FramePart extends PartBase {
  mass: number;
  toughness: number;
  style: 'stock' | 'forged' | 'reinforced';
}

export interface LightPart extends PartBase {
  mass: number;
  /** Headlight intensity multiplier (0 = none). */
  intensity: number;
  style: 'round' | 'bar' | 'none';
}

export interface BrakePart extends PartBase {
  mass: number;
  frontTorque: number;
  rearTorque: number;
  /** Bite: how quickly brake torque builds with lever input (exponent < 1 = grabby). */
  bite: number;
  rotor: number;
  abs: boolean;
}

export interface CoolingPart extends PartBase {
  mass: number;
  /** Multipliers on the motor's thermal mass and heat rejection. */
  thermalScale: number;
  coolingScale: number;
  style: 'none' | 'fins' | 'jacket';
}

export interface DamperPart extends PartBase {
  mass: number;
  /** 0 = none; higher = more steering damping at speed. */
  damping: number;
}

export interface PegPart extends PartBase {
  /** Extra mass over the stock pegs (which are counted in the frame), kg. */
  mass: number;
  /** Peg height offset (m; negative = lower) and width (m). */
  height: number;
  width: number;
  /** Multiplier on how far the rider can shift weight fore/aft. */
  leverage: number;
}

export interface HandguardPart extends PartBase {
  mass: number;
  cda: number;
  toughness: number;
  style: 'none' | 'open' | 'wrap';
}

export type SurfaceId = 'asphalt' | 'concrete' | 'dirt' | 'grass' | 'sand' | 'gravel';

// ---------------------------------------------------------------------------

export const MOTORS: MotorPart[] = [
  {
    // Modelled on the published Stark Varg MX figures: 80 hp (60 kW) peak and about 938 N·m at
    // the rear wheel on stock gearing (12/48 with the 2.5:1 primary).
    id: 'varg80', name: 'Varg 80 hp', mass: 9.0, peakTorque: 97, ratedPower: 60000, kv: 150,
    primaryRatio: 2.5, efficiency: 0.93, thermalMass: 9000, cooling: 22, deratingStart: 120, maxTemp: 160, whine: 1.25,
    desc: 'Factory Varg motor: 80 hp and instant torque.',
    pros: ['Huge, instant torque', 'Revs out to a high top speed', 'Runs cool'],
    cons: ['Breaks the rear loose easily', 'Needs the matching controller and pack'],
  },
  {
    id: 'pulse4', name: 'Pulse M4', mass: 5.2, peakTorque: 24, ratedPower: 4500, kv: 118,
    primaryRatio: 2.5, efficiency: 0.92, thermalMass: 4200, cooling: 9, deratingStart: 105, maxTemp: 140, whine: 1.15,
    desc: 'Compact trail motor. Smooth and efficient.',
    pros: ['Lightest motor', 'Very efficient — best range', 'Runs cool'],
    cons: ['Modest torque', 'Struggles to lift the front'],
  },
  {
    id: 'arc6', name: 'Arc M6', mass: 7.0, peakTorque: 30, ratedPower: 6000, kv: 108,
    primaryRatio: 2.5, efficiency: 0.91, thermalMass: 5200, cooling: 10, deratingStart: 110, maxTemp: 145, whine: 1.0,
    desc: 'The balanced stock mid-drive.',
    pros: ['Balanced torque and speed', 'Predictable'],
    cons: ['Jack of all trades'],
  },
  {
    id: 'brick10', name: 'Torque Brick T10', mass: 10.5, peakTorque: 50, ratedPower: 10000, kv: 90,
    primaryRatio: 2.5, efficiency: 0.9, thermalMass: 7600, cooling: 12, deratingStart: 110, maxTemp: 150, whine: 0.8,
    desc: 'Big-diameter low-speed motor. Huge shove off the line.',
    pros: ['Massive low-end torque', 'Easy wheelies'],
    cons: ['Heavy', 'Low top speed on stock gearing', 'Heats up under abuse'],
  },
  {
    id: 'spin12', name: 'Spinner HS12', mass: 9.0, peakTorque: 36, ratedPower: 12000, kv: 140,
    primaryRatio: 2.5, efficiency: 0.92, thermalMass: 6400, cooling: 13, deratingStart: 115, maxTemp: 150, whine: 1.4,
    desc: 'High-revving motor for speed builds.',
    pros: ['Highest top speed', 'Strong mid-range power'],
    cons: ['Soft launch', 'Needs a strong battery and controller'],
  },
  {
    id: 'monster22', name: 'Monster Coil T22', mass: 15.0, peakTorque: 75, ratedPower: 22000, kv: 104,
    primaryRatio: 2.5, efficiency: 0.89, thermalMass: 10000, cooling: 15, deratingStart: 105, maxTemp: 150, whine: 0.7,
    desc: 'Overkill. Requires a race controller to wake up.',
    pros: ['Brutal torque and power'],
    cons: ['Very heavy', 'Traction-limited', 'Overheats if ridden hard', 'Drains batteries fast'],
  },
];

export const CONTROLLERS: ControllerPart[] = [
  {
    id: 'vargctl', name: 'Varg Inverter', mass: 2.4, torqueFactor: 1.0, maxPower: 60000, rampRate: 9, regenMax: 0.6,
    tractionControl: true, heat: 1.1, pwmTone: 1.3,
    desc: 'Factory inverter with traction control and smooth power mapping.',
    pros: ['Full 80 hp', 'Traction control', 'Strong regen'],
    cons: ['Only makes sense with a big motor and pack'],
  },
  {
    id: 'stock60', name: 'Stock 60A', mass: 1.6, torqueFactor: 0.85, maxPower: 6500, rampRate: 4, regenMax: 0.25,
    tractionControl: false, heat: 1.0, pwmTone: 1.0,
    desc: 'Factory controller with gentle mapping.',
    pros: ['Smooth and forgiving', 'Gentle on the motor'],
    cons: ['Caps power hard', 'Weak regen', 'No traction or wheelie control'],
  },
  {
    id: 'trail90', name: 'Trail 90A', mass: 1.8, torqueFactor: 1.0, maxPower: 9500, rampRate: 6, regenMax: 0.5,
    tractionControl: true, heat: 1.05, pwmTone: 1.15,
    desc: 'Off-road controller tuned for controllable torque.',
    pros: ['Full motor torque', 'Strong regen', 'Traction and wheelie control'],
    cons: ['Moderate power cap'],
  },
  {
    id: 'race150', name: 'Race 150A', mass: 2.2, torqueFactor: 1.15, maxPower: 16000, rampRate: 10, regenMax: 0.55,
    tractionControl: true, heat: 1.25, pwmTone: 1.35,
    desc: 'Overdrives the motor phases for more torque.',
    pros: ['Overdrives torque +15%', 'Fast throttle response'],
    cons: ['Motor runs hotter', 'Snappy on loose ground'],
  },
  {
    id: 'apex300', name: 'Apex 300A', mass: 2.9, torqueFactor: 1.3, maxPower: 30000, rampRate: 16, regenMax: 0.6,
    tractionControl: true, heat: 1.5, pwmTone: 1.6,
    desc: 'Competition-only. Unlocks big motors.',
    pros: ['Huge power ceiling', 'Instant response'],
    cons: ['Heavy heat load', 'Brutal on stock tires', 'Drains the battery'],
  },
];

export const BATTERIES: BatteryPart[] = [
  {
    id: 'varg72', name: 'Varg 7.2 kWh', mass: 58.0, voltage: 72, capacityWh: 7200, maxPower: 62000, resistance: 0.02,
    heightOffset: 0, size: 1.3,
    desc: 'Factory high-capacity pack and its structural housing (the frame is built around it).',
    pros: ['Feeds 80 hp without sag', 'Long range'],
    cons: ['Heaviest pack'],
  },
  {
    id: 'lite60', name: 'Lite 60V 20Ah', mass: 7.0, voltage: 60, capacityWh: 1200, maxPower: 8000, resistance: 0.11,
    heightOffset: 0.02, size: 0.8,
    desc: 'Featherweight pack for stunt and jump builds.',
    pros: ['Lightest pack', 'Lively handling'],
    cons: ['Short range', 'More voltage sag'],
  },
  {
    id: 'stock60', name: 'Stock 60V 32Ah', mass: 11.0, voltage: 60, capacityWh: 1920, maxPower: 10000, resistance: 0.07,
    heightOffset: 0, size: 1.0,
    desc: 'Factory pack.',
    pros: ['Balanced weight and range'],
    cons: ['Limits high-power controllers'],
  },
  {
    id: 'range60', name: 'Range 60V 50Ah', mass: 16.0, voltage: 60, capacityWh: 3000, maxPower: 12000, resistance: 0.05,
    heightOffset: -0.02, size: 1.15,
    desc: 'Long-range pack for exploring.',
    pros: ['Big range', 'Low sag'],
    cons: ['Heavy', 'Slower to flick'],
  },
  {
    id: 'volt72', name: 'Volt+ 72V 40Ah', mass: 15.0, voltage: 72, capacityWh: 2880, maxPower: 20000, resistance: 0.05,
    heightOffset: 0.01, size: 1.12,
    desc: 'Higher voltage spins motors faster.',
    pros: ['+20% motor speed (top speed)', 'High power'],
    cons: ['Heavy', 'Pricey on heat at full power'],
  },
  {
    id: 'hyper84', name: 'Hyper 84V 45Ah', mass: 20.0, voltage: 84, capacityWh: 3780, maxPower: 35000, resistance: 0.04,
    heightOffset: 0.04, size: 1.3,
    desc: 'Race-grade high-voltage pack.',
    pros: ['Highest voltage and power', 'Big capacity'],
    cons: ['Heaviest pack', 'Raises the centre of mass'],
  },
];

const S = (a: number, c: number, d: number, g: number, s: number, gr: number): Record<SurfaceId, number> => ({
  asphalt: a, concrete: c, dirt: d, grass: g, sand: s, gravel: gr,
});

export const TREADS: TreadPart[] = [
  {
    id: 'street', name: 'Street Slick-Groove', mass: 0, rolling: 0.8, slideRatio: 0.88, hum: 0.1,
    mu: S(1.18, 1.08, 0.62, 0.5, 0.34, 0.55), stiffness: S(1.15, 1.1, 0.9, 0.85, 0.75, 0.85),
    desc: 'Supermoto street tread.',
    pros: ['Best tarmac grip', 'Low rolling resistance', 'Precise steering'],
    cons: ['Slippery off-road', 'Hopeless in sand'],
  },
  {
    id: 'dualsport', name: 'Dual-Sport Block', mass: 0.2, rolling: 1.0, slideRatio: 0.84, hum: 0.35,
    mu: S(1.0, 0.95, 0.8, 0.68, 0.5, 0.74), stiffness: S(1.0, 1.0, 0.95, 0.9, 0.8, 0.9),
    desc: 'Compromise tread for mixed riding.',
    pros: ['Decent everywhere'],
    cons: ['Not the best anywhere'],
  },
  {
    id: 'knobby', name: 'MX Knobby', mass: 0.4, rolling: 1.25, slideRatio: 0.8, hum: 0.75,
    mu: S(0.84, 0.82, 0.98, 0.86, 0.66, 0.9), stiffness: S(0.78, 0.8, 1.0, 0.95, 0.85, 0.95),
    desc: 'Aggressive off-road knobs.',
    pros: ['Excellent dirt and grass bite', 'Good on gravel'],
    cons: ['Squirms on tarmac', 'Loud and draggy on the road'],
  },
  {
    id: 'paddle', name: 'Sand Paddle', mass: 0.6, rolling: 1.5, slideRatio: 0.78, hum: 0.9,
    mu: S(0.56, 0.56, 0.86, 0.8, 1.0, 0.7), stiffness: S(0.7, 0.7, 0.9, 0.88, 1.0, 0.85),
    desc: 'Scoop tread for sand and mud.',
    pros: ['Dominates sand'],
    cons: ['Terrible on tarmac', 'Very draggy'],
  },
];

export const COMPOUNDS: CompoundPart[] = [
  {
    id: 'soft', name: 'Soft', muScale: 1.08, slideRatioDelta: 0.04, rolling: 1.15,
    desc: 'Sticky rubber.', pros: ['+8% grip', 'Holds traction while sliding'], cons: ['Harder to break loose for drifts', 'More rolling drag'],
  },
  {
    id: 'medium', name: 'Medium', muScale: 1.0, slideRatioDelta: 0, rolling: 1.0,
    desc: 'All-round compound.', pros: ['Predictable'], cons: [],
  },
  {
    id: 'hard', name: 'Hard', muScale: 0.92, slideRatioDelta: -0.05, rolling: 0.9,
    desc: 'Durable, slippery compound.', pros: ['Easy, long drifts', 'Low rolling drag'], cons: ['-8% grip', 'Longer braking'],
  },
];

export const RIM_STYLES: RimStylePart[] = [
  { id: 'spoke', name: 'Laced Spoke', massScale: 1.0, desc: 'Classic laced wheel.', pros: ['Light'], cons: [] },
  { id: 'cast', name: 'Cast 6-Spoke', massScale: 1.15, desc: 'Solid cast street wheel.', pros: ['Street look'], cons: ['Heavier — more rotating inertia'] },
  { id: 'star', name: 'Forged Star', massScale: 0.92, desc: 'Forged 5-star.', pros: ['Lightest rims'], cons: [], unlock: 'cores10' },
  { id: 'disc', name: 'Aero Disc', massScale: 1.25, desc: 'Full disc covers.', pros: ['Wild look'], cons: ['Heaviest — slow to spin up'], unlock: 'cores20' },
];

export const FRONT_DIAMETERS = [16, 17, 19, 21] as const;
export const REAR_DIAMETERS = [16, 17, 18, 19] as const;
export const FRONT_WIDTHS = [70, 80, 90, 110] as const;
export const REAR_WIDTHS = [80, 100, 120, 140] as const;
export const PROFILES = [70, 80, 100] as const;

export const FORKS: ForkPart[] = [
  {
    id: 'mx310', name: 'Factory MX 310', mass: 8.0, travel: 0.31, length: 0.82, springRate: 10000, damping: 600, progression: 0.55,
    inverted: true,
    desc: 'Full-size 310 mm motocross fork.', pros: ['Swallows big jumps', 'Plush in the rough'], cons: ['Heavy', 'Tall'],
  },
  {
    id: 'stock', name: 'Stock Coil 200', mass: 6.0, travel: 0.2, length: 0.7, springRate: 10500, damping: 520, progression: 0.4,
    inverted: false,
    desc: 'Factory right-side-up fork.', pros: ['Plush', 'Balanced'], cons: ['Dives under hard braking'],
  },
  {
    id: 'enduro', name: 'Enduro LT 250', mass: 7.2, travel: 0.25, length: 0.77, springRate: 9200, damping: 560, progression: 0.55,
    inverted: true,
    desc: 'Long-travel inverted fork.', pros: ['Soaks up big landings', 'Raises ground clearance'], cons: ['Heavier', 'Taller — higher CoM', 'More pitching'],
  },
  {
    id: 'sm', name: 'Supermoto USD 160', mass: 6.6, travel: 0.16, length: 0.64, springRate: 15000, damping: 720, progression: 0.3,
    inverted: true,
    desc: 'Short stiff fork for tarmac.', pros: ['Sharp turn-in', 'Little dive', 'Lowers CoM'], cons: ['Harsh off-road', 'Bottoms on big jumps'],
  },
];

export const SHOCKS: ShockPart[] = [
  {
    id: 'mx310', name: 'Factory MX Shock 310', mass: 3.6, travel: 0.31, springRate: 12500, damping: 720, progression: 0.6, rideHeight: 0.04,
    desc: 'Full-size motocross shock and linkage.', pros: ['Big-hit capable', 'Great rear traction'], cons: ['Tall seat'],
  },
  {
    id: 'stock', name: 'Stock Shock 210', mass: 1.8, travel: 0.21, springRate: 12500, damping: 620, progression: 0.4, rideHeight: 0,
    desc: 'Factory coil-over.', pros: ['Balanced'], cons: [],
  },
  {
    id: 'enduro', name: 'Enduro Shock 260', mass: 2.3, travel: 0.26, springRate: 11000, damping: 680, progression: 0.55, rideHeight: 0.03,
    desc: 'Long-stroke shock with progressive linkage.', pros: ['Big-hit capable', 'More rear traction on rough ground'], cons: ['Squats on throttle', 'Taller seat'],
  },
  {
    id: 'sm', name: 'Supermoto Shock 170', mass: 2.0, travel: 0.17, springRate: 18000, damping: 820, progression: 0.3, rideHeight: -0.025,
    desc: 'Stiff short shock.', pros: ['Holds a line on tarmac', 'Less squat'], cons: ['Skips on bumps', 'Bottoms on jumps'],
  },
];

export const SWINGARMS: SwingarmPart[] = [
  { id: 'short', name: 'Short -40mm', mass: 2.8, length: 0.52, desc: 'Shorter swingarm.', pros: ['Quick turning', 'Wheelies pop up easily'], cons: ['Twitchy at speed', 'Loops out easily'] },
  { id: 'stock', name: 'Stock 560mm', mass: 3.0, length: 0.56, desc: 'Factory swingarm.', pros: ['Balanced'], cons: [] },
  { id: 'ext60', name: 'Extended +60mm', mass: 3.4, length: 0.62, desc: 'Stretched for stability.', pros: ['Stable at speed', 'Resists wheelies'], cons: ['Slower turning', 'Heavier'] },
  { id: 'ext120', name: 'Drag +120mm', mass: 3.9, length: 0.68, desc: 'Drag-strip length.', pros: ['Max launch stability', 'Long smooth drifts'], cons: ['Wide turning circle', 'Hard to wheelie'] },
];

export const YOKES: YokePart[] = [
  { id: 'quick', name: 'Quick Clamps', rake: 24.5, offset: 0.042, desc: 'Steeper rake, more offset: less trail.', pros: ['Fast turn-in', 'Agile at low speed'], cons: ['Less stable at speed'] },
  { id: 'stock', name: 'Stock Clamps', rake: 26, offset: 0.035, desc: 'Factory geometry.', pros: ['Balanced'], cons: [] },
  { id: 'stable', name: 'Stable Clamps', rake: 27.5, offset: 0.028, desc: 'Slacker rake, more trail.', pros: ['Rock-solid at speed', 'Self-corrects slides'], cons: ['Slower steering'] },
];

export const HANDLEBARS: HandlebarPart[] = [
  { id: 'flat', name: 'Flat Street Bar', mass: 0.9, rise: 0.02, width: 0.7, leverage: 0.88, riderHeight: -0.04, cda: -0.04, desc: 'Low tucked bar.', pros: ['Lower drag', 'Lower CoM'], cons: ['Less leverage — slower flicks'] },
  { id: 'stock', name: 'Stock Bar', mass: 1.0, rise: 0.06, width: 0.76, leverage: 1.0, riderHeight: 0, cda: 0, desc: 'Factory bend.', pros: ['Balanced'], cons: [] },
  { id: 'mx', name: 'MX Tall Bar', mass: 1.1, rise: 0.11, width: 0.82, leverage: 1.14, riderHeight: 0.05, cda: 0.04, desc: 'Tall wide bend.', pros: ['More leverage — quick flicks', 'Easier wheelies'], cons: ['Higher CoM', 'More drag'] },
];

export const SEATS: SeatPart[] = [
  { id: 'low', name: 'Low Seat', mass: 0.9, height: -0.03, length: 0.56, desc: 'Lower foam.', pros: ['Lower CoM'], cons: ['Less room to move'] },
  { id: 'stock', name: 'Stock Seat', mass: 1.1, height: 0, length: 0.6, desc: 'Factory seat.', pros: ['Balanced'], cons: [] },
  { id: 'mx', name: 'Flat MX Seat', mass: 1.2, height: 0.025, length: 0.66, desc: 'Long flat seat.', pros: ['Rider can shift weight further'], cons: ['Higher CoM'] },
];

export const FENDERS: FenderPart[] = [
  { id: 'stock', name: 'Stock Fenders', mass: 0.8, cda: 0, style: 'stock', desc: 'Factory fenders.', pros: [], cons: [] },
  { id: 'high', name: 'High MX Fender', mass: 0.9, cda: 0.01, style: 'high', desc: 'Raised front fender.', pros: ['Classic MX look'], cons: ['Tiny drag increase'] },
  { id: 'short', name: 'Short Street', mass: 0.5, cda: -0.01, style: 'short', desc: 'Chopped fenders.', pros: ['Lighter'], cons: [] },
];

export const BODY_KITS: BodyKitPart[] = [
  { id: 'stock', name: 'Stock Plastics', mass: 2.5, cda: 0, toughness: 1.0, style: 'stock', desc: 'Factory panels.', pros: ['Balanced'], cons: [] },
  { id: 'race', name: 'Race Lite Panels', mass: 1.3, cda: 0, toughness: 0.85, style: 'race', desc: 'Thin minimal plastics.', pros: ['-1.2 kg'], cons: ['Less crash tolerance'] },
  { id: 'armor', name: 'Armor Kit', mass: 5.0, cda: 0.03, toughness: 1.45, style: 'armor', desc: 'Skid plates and guards.', pros: ['Survives harder impacts'], cons: ['+2.5 kg', 'More drag'] },
  { id: 'fairing', name: 'SM Fairing', mass: 3.4, cda: -0.07, toughness: 0.95, style: 'fairing', desc: 'Small aero fairing.', pros: ['Less drag — higher top speed'], cons: ['+0.9 kg'], unlock: 'cores5' },
];

export const FRAMES: FramePart[] = [
  { id: 'stock', name: 'Stock Alloy Frame', mass: 8.5, toughness: 1.0, style: 'stock', desc: 'Factory frame.', pros: ['Balanced'], cons: [] },
  { id: 'forged', name: 'Forged Lite Frame', mass: 7.0, toughness: 0.9, style: 'forged', desc: 'Machined lightweight frame.', pros: ['-1.5 kg'], cons: ['Slightly less crash tolerance'] },
  { id: 'reinforced', name: 'Reinforced Frame', mass: 10.5, toughness: 1.3, style: 'reinforced', desc: 'Gusseted stunt frame.', pros: ['Shrugs off crashes'], cons: ['+2 kg'] },
];

export const LIGHTS: LightPart[] = [
  { id: 'round', name: 'Round Headlight', mass: 0.6, intensity: 1, style: 'round', desc: 'Factory light.', pros: [], cons: [] },
  { id: 'bar', name: 'LED Light Bar', mass: 0.8, intensity: 1.8, style: 'bar', desc: 'Bright LED bar.', pros: ['Brighter at night'], cons: ['+0.2 kg'] },
  { id: 'none', name: 'No Lights', mass: 0, intensity: 0, style: 'none', desc: 'Stripped.', pros: ['-0.6 kg'], cons: ['Nothing at night'] },
];

export const BRAKES: BrakePart[] = [
  { id: 'stock', name: 'Stock 2-Piston', mass: 2.0, frontTorque: 270, rearTorque: 170, bite: 1.0, rotor: 0.203, abs: false, desc: 'Factory brakes.', pros: ['Progressive'], cons: ['Fades under big builds'] },
  { id: 'quad', name: '4-Piston 220', mass: 2.6, frontTorque: 420, rearTorque: 240, bite: 0.85, rotor: 0.22, abs: false, desc: 'Stronger calipers.', pros: ['Shorter stops', 'Easier stoppies'], cons: ['Grabby — easier to lock'] },
  { id: 'race', name: 'Race 4-Piston 260', mass: 3.2, frontTorque: 600, rearTorque: 300, bite: 0.75, rotor: 0.26, abs: false, desc: 'Oversized race rotors.', pros: ['Massive stopping power'], cons: ['Very grabby', 'Heavier'] },
  { id: 'abs', name: 'Street ABS Kit', mass: 3.4, frontTorque: 400, rearTorque: 230, bite: 0.95, rotor: 0.22, abs: true, desc: 'Anti-lock brakes.', pros: ['Wheels never lock', 'Stable stops'], cons: ['Heaviest', 'No rear skid drifts', 'Limits stoppies'] },
];

export const COOLING: CoolingPart[] = [
  { id: 'stock', name: 'Stock Air Cooling', mass: 0, thermalScale: 1, coolingScale: 1, style: 'none', desc: 'Bare motor case.', pros: ['Lightest'], cons: ['Overheats on long full-power runs'] },
  { id: 'fins', name: 'Finned Motor Cover', mass: 0.5, thermalScale: 1.25, coolingScale: 1.35, style: 'fins', desc: 'Machined heat-sink cover.', pros: ['Runs cooler', 'Delays thermal derate'], cons: ['+0.5 kg'] },
  { id: 'jacket', name: 'Liquid Cooling Jacket', mass: 1.7, thermalScale: 1.7, coolingScale: 2.0, style: 'jacket', desc: 'Coolant jacket and small radiator.', pros: ['Holds full power far longer'], cons: ['+1.7 kg', 'Radiator adds a little drag'] },
];

export const DAMPERS: DamperPart[] = [
  { id: 'none', name: 'No Steering Damper', mass: 0, damping: 0, desc: 'Bars move freely.', pros: ['Quickest turn-in'], cons: ['Twitchy at speed'] },
  { id: 'trail', name: 'Trail Damper', mass: 0.35, damping: 0.6, desc: 'Light rotary damper.', pros: ['Calmer at speed and on landings'], cons: ['Slightly slower turn-in'] },
  { id: 'race', name: 'Race Damper', mass: 0.55, damping: 1.2, desc: 'Stiff linear damper.', pros: ['Rock-solid at high speed'], cons: ['Heavy steering in tight turns', '+0.55 kg'] },
];

export const PEGS: PegPart[] = [
  { id: 'stock', name: 'Stock Pegs', mass: 0, height: 0, width: 0.05, leverage: 1, desc: 'Factory pegs.', pros: ['Balanced'], cons: [] },
  { id: 'wide', name: 'Wide MX Pegs', mass: 0.2, height: 0, width: 0.075, leverage: 1.2, desc: 'Big serrated platform.', pros: ['More weight-shift control (wheelies, stoppies, air)'], cons: ['+0.2 kg'] },
  { id: 'low', name: 'Lowered Pegs', mass: 0.1, height: -0.03, width: 0.055, leverage: 1.05, desc: 'Pegs 30 mm lower.', pros: ['Lower centre of mass', 'More legroom'], cons: ['Scrape earlier when leaned over'] },
];

export const HANDGUARDS: HandguardPart[] = [
  { id: 'none', name: 'No Handguards', mass: 0, cda: 0, toughness: 1, style: 'none', desc: 'Bare levers.', pros: ['Lightest'], cons: [] },
  { id: 'open', name: 'Roost Deflectors', mass: 0.25, cda: 0.005, toughness: 1.03, style: 'open', desc: 'Plastic deflectors.', pros: ['Classic look'], cons: ['Tiny drag'] },
  { id: 'wrap', name: 'Wrap-Around Guards', mass: 0.6, cda: 0.01, toughness: 1.1, style: 'wrap', desc: 'Alloy-backed guards.', pros: ['Better crash tolerance'], cons: ['+0.6 kg', 'More drag'] },
];

export const HELMET_STYLES = [
  { id: 'mx', name: 'MX (peak + goggles)' },
  { id: 'full', name: 'Full-face street' },
  { id: 'trail', name: 'Trail (open face)' },
] as const;
export type HelmetStyle = (typeof HELMET_STYLES)[number]['id'];

export const DECALS = [
  { id: 'none', name: 'None' },
  { id: 'stripes', name: 'Race Stripes' },
  { id: 'bolt', name: 'Voltage Bolt' },
  { id: 'chevron', name: 'Chevrons' },
  { id: 'camo', name: 'Digital Camo', unlock: 'cores15' },
  { id: 'circuit', name: 'Circuit Trace', unlock: 'medal3' },
  { id: 'split', name: 'Two-Tone Split' },
  { id: 'checker', name: 'Checker Flag' },
  { id: 'waves', name: 'Speed Waves' },
] as const;

export const FINISHES = [
  { id: 'gloss', name: 'Gloss', roughness: 0.25, metalness: 0.05 },
  { id: 'matte', name: 'Matte', roughness: 0.85, metalness: 0.0 },
  { id: 'satin', name: 'Satin', roughness: 0.5, metalness: 0.1 },
  { id: 'metallic', name: 'Metallic', roughness: 0.3, metalness: 0.75 },
  { id: 'chrome', name: 'Chrome', roughness: 0.08, metalness: 1.0 },
  { id: 'pearl', name: 'Pearl', roughness: 0.18, metalness: 0.35 },
] as const;

export type DecalId = (typeof DECALS)[number]['id'];
export type FinishId = (typeof FINISHES)[number]['id'];

export const PALETTE = [
  '#e8e8ea', '#1b1d22', '#3a3f48', '#d7263d', '#ff6b1a', '#ffc914', '#c6f432', '#2ec4b6',
  '#1e88e5', '#3a2bd8', '#8e44ad', '#ff4fa3', '#6b8f3a', '#8a6a46', '#00e5ff', '#c0c4cc',
];

export function byId<T extends PartBase>(list: T[], id: string): T {
  return list.find((p) => p.id === id) ?? list[0];
}
