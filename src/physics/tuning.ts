/**
 * Centralised physics tuning. Everything that shapes how riding *feels* but is not a
 * property of a specific bike part lives here, so handling can be iterated without
 * touching the dynamics code.
 */
import type { SurfaceId } from '../vehicle/parts';

export const TUNING = {
  /** Fixed physics step (s). Rendering interpolates between steps. */
  dt: 1 / 240,
  /** Wheel-spin sub-iterations per physics step (stiff tire/wheel coupling). */
  wheelSubsteps: 6,
  gravity: 9.81,
  airDensity: 1.2,

  tire: {
    /** Speed below which slip is normalised by this value (avoids singular slip at rest). */
    lowSpeedLong: 2.5,
    lowSpeedLat: 1.5,
    /** Fall-off rate past peak slip toward the sliding coefficient. */
    falloff: 1.6,
    /** Max normal load per tire (N) to keep impulses bounded. */
    maxLoad: 16000,
    /** Contact-normal component along the suspension axis below which load is clamped. */
    minAxisDot: 0.35,
    /** Probe angles around the wheel bottom (deg) for curb/edge detection. */
    probeAngles: [0, -18, 18, -36, 36, -56, 56, -74, 74],
  },

  suspension: {
    bumpStop: 140000,
    bumpDamping: 3500,
    /** Clamp on suspension velocity used by dampers, m/s. */
    maxVelocity: 4,
  },

  body: {
    contactStiffness: 60000,
    contactDamping: 2600,
    friction: 0.55,
    /** Angular damping (N·m·s/rad) to keep tumbling sane. */
    angularDrag: 1.2,
    maxAngularSpeed: 18,
    maxSpeed: 70,
  },

  steering: {
    /** Max steering rate, rad/s. */
    rate: 5.5,
    /** Max lean angle at speed (rad). */
    maxLean: 0.86,
    /** Lean available at walking pace (rad). */
    lowSpeedLean: 0.16,
    /** Speed (m/s) range over which lean authority ramps in. */
    leanRampStart: 1.5,
    leanRampEnd: 11,
    /** Below this speed steering is direct (no lean-controller). */
    directSpeed: 2.2,
    blendSpeed: 4.0,
    /** Rider countersteer controller gains. */
    /** Desired roll rate per rad of lean error (1/s) and max roll rate (rad/s). */
    leanGain: 4,
    maxRollRate: 1.8,
    /** Steering per rad/s of roll-rate error. */
    kd: 0.22,
    /** Front-wheel self-alignment toward travel direction while the rear slides (caster). */
    caster: 1.0,
    /** Steering is limited to this multiple of the max-grip curvature steer angle at speed. */
    speedSteerLimit: 3.5,
    minSteerLimit: 0.05,
    /** Max front slip angle the rider steers to, as a multiple of the tire's peak angle. */
    slipLimit: 1.15,
  },

  assist: {
    /** Roll assist stiffness / damping at riding speed (scaled by user assist level). */
    rollStiffness: 260,
    rollDamping: 70,
    /** Extra roll support at standstill (the rider's foot down). */
    standStiffness: 2600,
    standDamping: 420,
    standSpeed: 6,
    /** Yaw damping to tame snap oversteer (scaled by assist). */
    yawDamping: 35,
    /** Yaw damping applied only in big slides (N·m·s/rad, scaled by assist). */
    slideYawDamping: 180,
    /** Roll support from the rider's foot in big slides (scaled by assist). */
    /** Lean "save": torque that stands the bike up once it leans past what the rider can hold. */
    catchStiffness: 1400,
    catchDamping: 260,
    slideRollStiffness: 900,
    slideRollDamping: 160,
    airRollStiffness: 160,
    /** In-air pitch levelling toward the flight path (scaled by assist, off while leaning). */
    airPitchStiffness: 420,
    airPitchDamping: 160,
    airRollDamping: 40,
  },

  rider: {
    /** Pitch torque from rider pulling/pushing the bars on the ground (N·m). */
    groundPitch: 170,
    /** In-air pitch control torque (N·m). */
    airPitch: 520,
    airYaw: 110,
    airRoll: 140,
    /** Damping of pitch while balancing a wheelie/stoppie. */
    balanceDamping: 110,
    shiftRate: 4,
    /** Pitch (rad) at which the rider instinctively eases the front brake / throttle. */
    stoppieLimit: 0.12,
    stoppieLookahead: 0.3,
    loopLimit: 0.55,
    /** Rear slip ratio a rider lets the tire reach at full assist. */
    spinLimit: 0.35,
    /** Rear slip angle (rad) past which the rider rolls off to stay within steering lock. */
    slideLimit: 0.55,
  },

  /** Wheelie / stoppie trick buttons (see BikeDynamics.step). Pitch in rad, times in s. */
  tricks: {
    /** Initial target pitch for the wheelie button (a comfortable wheelie). */
    wheelieBase: 0.5,
    /** Hold time before the target starts creeping up. */
    holdGrace: 1.5,
    /** Target pitch increase per second of holding after the grace time. */
    wheelieRamp: 0.33,
    /** Base throttle used to hold the wheelie. */
    wheelieThrottle: 0.45,
    /** Pitch at which the rider can no longer save it and falls off the back. */
    loopOut: 1.22,
    stoppieBase: 0.16,
    stoppieRamp: 0.22,
    /** Nose-down pitch at which a held stoppie goes over the bars. */
    overBars: 0.95,
  },
  crash: {
    /** Lean angle (rad) past which a grounded bike is considered down. */
    lean: 1.2,
    /** Impact speed into the ground for rider-body probes (m/s, scaled by toughness). */
    impact: 3.2,
    /** Hard landing that bottoms the suspension faster than this crashes (m/s). */
    landing: 10.5,
    autoReset: 3.2,
  },
};

export interface SurfaceProps {
  /** Rolling resistance coefficient for a reference tire. */
  crr: number;
  /** Extra speed-proportional drag on loose surfaces (N per N load per m/s). */
  sink: number;
  /** Visual/audio: dust colour and loudness. */
  dust: number;
  color: [number, number, number];
  /** Tire marks show on this surface. */
  marks: boolean;
  /** Surface roughness for suspension chatter (m amplitude). */
  rough: number;
}

export const SURFACE_PROPS: Record<SurfaceId, SurfaceProps> = {
  asphalt: { crr: 0.014, sink: 0, dust: 0.1, color: [0.75, 0.75, 0.75], marks: true, rough: 0 },
  concrete: { crr: 0.015, sink: 0, dust: 0.15, color: [0.8, 0.8, 0.78], marks: true, rough: 0 },
  dirt: { crr: 0.035, sink: 0.002, dust: 1, color: [0.55, 0.42, 0.3], marks: true, rough: 0.006 },
  grass: { crr: 0.05, sink: 0.003, dust: 0.5, color: [0.35, 0.45, 0.2], marks: true, rough: 0.008 },
  sand: { crr: 0.11, sink: 0.01, dust: 1.2, color: [0.85, 0.75, 0.55], marks: true, rough: 0.004 },
  gravel: { crr: 0.04, sink: 0.004, dust: 0.8, color: [0.6, 0.58, 0.55], marks: true, rough: 0.01 },
};

export const RIDE_MODES = {
  eco: { label: 'ECO', torque: 0.6, power: 0.45, speed: 0.7, regen: 1.25 },
  standard: { label: 'STD', torque: 0.85, power: 0.75, speed: 1.0, regen: 1.0 },
  sport: { label: 'SPORT', torque: 1.0, power: 1.0, speed: 1.0, regen: 0.8 },
} as const;
