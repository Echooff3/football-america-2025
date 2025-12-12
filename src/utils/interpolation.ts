import type { SimulationFrame, PlayerState } from '../data/types';

/**
 * Keyframe-based interpolation system for football simulation.
 * Uses sparse keyframes from AI and interpolates smooth animation frames.
 */

// Compressed keyframe format from AI (minimal data)
export interface CompressedKeyframe {
  t: number; // tick number
  b: [number, number, number]; // ball [x, y, z]
  p: Array<[string, number, number, number, string]>; // player [id, x, z, rotation, animation]
  e?: string[]; // events (optional)
}

export interface CompressedSimulation {
  outcome: "touchdown" | "tackle" | "incomplete" | "complete" | "interception" | "turnover";
  summary: string;
  timeElapsed?: number; // seconds elapsed during the play (optional, defaults to 15 if not provided)
  keyframes: CompressedKeyframe[];
}

/**
 * Linear interpolation between two values
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp t to [0, 1] range
 */
function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Interpolate rotation with wrapping (handles 0-360 wrap)
 */
function lerpAngle(a: number, b: number, t: number): number {
  // Normalize to -180 to 180
  let diff = b - a;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return a + diff * t;
}

/**
 * Find a player in a keyframe by ID
 */
function findPlayer(keyframe: CompressedKeyframe, playerId: string): [string, number, number, number, string] | null {
  for (const p of keyframe.p) {
    if (p[0] === playerId) {
      return p;
    }
  }
  return null;
}

/**
 * Get all unique player IDs from keyframes
 */
function getAllPlayerIds(keyframes: CompressedKeyframe[]): string[] {
  const ids = new Set<string>();
  for (const kf of keyframes) {
    for (const p of kf.p) {
      ids.add(p[0]);
    }
  }
  return Array.from(ids).sort();
}

/**
 * Find the two keyframes surrounding a given tick
 */
function findSurroundingKeyframes(
  keyframes: CompressedKeyframe[],
  tick: number
): { before: CompressedKeyframe; after: CompressedKeyframe; t: number } {
  // Find the keyframe just before or at this tick
  let beforeIndex = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].t <= tick) {
      beforeIndex = i;
    } else {
      break;
    }
  }
  
  const afterIndex = Math.min(beforeIndex + 1, keyframes.length - 1);
  const before = keyframes[beforeIndex];
  const after = keyframes[afterIndex];
  
  // Calculate interpolation factor
  let t = 0;
  if (before.t !== after.t) {
    t = (tick - before.t) / (after.t - before.t);
  }
  t = clamp01(t);
  
  return { before, after, t };
}

/**
 * Expand compressed keyframes into full simulation frames using LINEAR interpolation
 */
export function expandKeyframes(
  compressed: CompressedSimulation,
  _targetFPS: number = 10,
  _interpolationMethod: 'linear' | 'catmull-rom' = 'linear'
): SimulationFrame[] {
  const { keyframes } = compressed;
  
  if (keyframes.length === 0) {
    console.warn('No keyframes provided');
    return [];
  }
  
  // Sort keyframes by tick to ensure correct order
  const sortedKeyframes = [...keyframes].sort((a, b) => a.t - b.t);
  
  if (sortedKeyframes.length === 1) {
    return [decompressKeyframe(sortedKeyframes[0])];
  }
  
  const frames: SimulationFrame[] = [];
  const startTick = sortedKeyframes[0].t;
  const endTick = sortedKeyframes[sortedKeyframes.length - 1].t;
  
  // Get all player IDs that appear in any keyframe
  const allPlayerIds = getAllPlayerIds(sortedKeyframes);
  
  console.log(`Expanding ${sortedKeyframes.length} keyframes from tick ${startTick} to ${endTick}`);
  console.log(`Players: ${allPlayerIds.join(', ')}`);
  
  // Generate a frame for every tick
  for (let tick = startTick; tick <= endTick; tick++) {
    const { before, after, t } = findSurroundingKeyframes(sortedKeyframes, tick);
    
    // Interpolate ball position (simple linear)
    const ballX = lerp(before.b[0], after.b[0], t);
    const ballY = lerp(before.b[1], after.b[1], t);
    const ballZ = lerp(before.b[2], after.b[2], t);
    
    // Interpolate each player
    const players: PlayerState[] = [];
    
    for (const playerId of allPlayerIds) {
      const playerBefore = findPlayer(before, playerId);
      const playerAfter = findPlayer(after, playerId);
      
      if (!playerBefore && !playerAfter) {
        // Player doesn't exist in either keyframe - skip
        continue;
      }
      
      // Use available data, falling back to the other keyframe if one is missing
      const p0 = playerBefore || playerAfter!;
      const p1 = playerAfter || playerBefore!;
      
      // Interpolate position
      const x = lerp(p0[1], p1[1], t);
      const z = lerp(p0[2], p1[2], t);
      
      // Interpolate rotation (with angle wrapping)
      const rotation = lerpAngle(p0[3], p1[3], t);
      
      // Animation: use the "before" animation until halfway, then switch to "after"
      const animation = t < 0.5 ? p0[4] : p1[4];
      
      players.push({
        id: playerId,
        x,
        z,
        rotation,
        animation: animation as PlayerState['animation']
      });
    }
    
    // Events: only include on exact keyframe ticks
    const exactKeyframe = sortedKeyframes.find(k => k.t === tick);
    const events = exactKeyframe?.e || [];
    
    frames.push({
      tick,
      ball: {
        x: ballX,
        y: ballY,
        z: ballZ,
        rotation: { x: 0, y: 0, z: 0 }
      },
      players,
      events
    });
  }
  
  console.log(`Generated ${frames.length} interpolated frames`);
  
  return frames;
}

/**
 * Convert a single compressed keyframe to full SimulationFrame
 */
function decompressKeyframe(kf: CompressedKeyframe): SimulationFrame {
  return {
    tick: kf.t,
    ball: {
      x: kf.b[0],
      y: kf.b[1],
      z: kf.b[2],
      rotation: { x: 0, y: 0, z: 0 }
    },
    players: kf.p.map(([id, x, z, rotation, animation]) => ({
      id,
      x,
      z,
      rotation,
      animation: animation as PlayerState['animation']
    })),
    events: kf.e || []
  };
}

/**
 * Compress full simulation frames to keyframes (for storage optimization)
 */
export function compressFrames(
  frames: SimulationFrame[],
  keyframeInterval: number = 5
): CompressedKeyframe[] {
  const keyframes: CompressedKeyframe[] = [];
  
  for (let i = 0; i < frames.length; i += keyframeInterval) {
    const frame = frames[i];
    keyframes.push({
      t: frame.tick,
      b: [frame.ball.x, frame.ball.y, frame.ball.z],
      p: frame.players.map(p => [p.id, p.x, p.z, p.rotation, p.animation]),
      e: frame.events.length > 0 ? frame.events : undefined
    });
  }
  
  // Always include the last frame
  const lastFrame = frames[frames.length - 1];
  const lastKeyframe = keyframes[keyframes.length - 1];
  if (lastFrame.tick !== lastKeyframe.t) {
    keyframes.push({
      t: lastFrame.tick,
      b: [lastFrame.ball.x, lastFrame.ball.y, lastFrame.ball.z],
      p: lastFrame.players.map(p => [p.id, p.x, p.z, p.rotation, p.animation]),
      e: lastFrame.events.length > 0 ? lastFrame.events : undefined
    });
  }
  
  return keyframes;
}

/**
 * Estimate compression ratio
 */
export function getCompressionStats(
  originalFrameCount: number,
  keyframeCount: number
): { ratio: number; savedFrames: number } {
  return {
    ratio: originalFrameCount / keyframeCount,
    savedFrames: originalFrameCount - keyframeCount
  };
}
