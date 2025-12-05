/**
 * Ultra-compact encoding system for football animations.
 * Reduces data size by 70-80% compared to even compressed keyframes.
 * 
 * Format: Uses strings that humans can't read but decode efficiently.
 * Example: "T50|B:1a,2b,3c|P:o1:5,7,a,s>10,15,b,r;o2:0,5,c,i>0,20,d,s"
 * 
 * Philosophy:
 * - Time is relative (just start/end, interpolate between)
 * - Positions use base36 (0-9, a-z = 0-35) offset from center field
 * - Animations are single chars (i=idle, s=sprint, etc)
 * - Only 2-4 keyframes needed per play instead of 6-10
 */

// Animation codes (single character)
const ANIM_CODES: Record<string, string> = {
  'idle': 'i',
  'sprint': 's',
  'backpedal': 'b',
  'throw': 't',
  'catch': 'c',
  'tackle': 'k',
  'fall': 'f',
  'block': 'l'
};

const ANIM_DECODE: Record<string, string> = {
  'i': 'idle',
  's': 'sprint',
  'b': 'backpedal',
  't': 'throw',
  'c': 'catch',
  'k': 'tackle',
  'f': 'fall',
  'l': 'block'
};

// Outcome codes
const OUTCOME_CODES: Record<string, string> = {
  'touchdown': 'T',
  'tackle': 'K',
  'incomplete': 'I',
  'interception': 'X',
  'turnover': 'F'
};

const OUTCOME_DECODE: Record<string, string> = {
  'T': 'touchdown',
  'K': 'tackle',
  'I': 'incomplete',
  'X': 'interception',
  'F': 'turnover'
};

/**
 * Encode a number to base36 with precision
 * Range: -999 to 999 (field coordinates)
 * Offset by 1000 to make all positive, then base36
 */
function encodeCoord(n: number): string {
  const offset = Math.round(n * 10) + 10000; // x10 for 1 decimal, +10000 to avoid negatives
  return offset.toString(36);
}

/**
 * Decode base36 back to number
 */
function decodeCoord(s: string): number {
  const offset = parseInt(s, 36);
  return (offset - 10000) / 10;
}

/**
 * Encode rotation (0-360 degrees) to base36
 */
function encodeRotation(rad: number): string {
  // Convert radians to degrees, normalize to 0-360
  let deg = (rad * 180 / Math.PI) % 360;
  if (deg < 0) deg += 360;
  return Math.round(deg).toString(36);
}

/**
 * Decode rotation back to radians
 */
function decodeRotation(s: string): number {
  const deg = parseInt(s, 36);
  return (deg * Math.PI / 180);
}

/**
 * Ultra-compact format for a single keyframe waypoint:
 * "x,z,r,a" where x,z are coords, r is rotation, a is animation code
 */
interface WaypointData {
  x: number;
  z: number;
  rotation: number;
  animation: string;
}

function encodeWaypoint(w: WaypointData): string {
  return `${encodeCoord(w.x)},${encodeCoord(w.z)},${encodeRotation(w.rotation)},${ANIM_CODES[w.animation] || 'i'}`;
}

function decodeWaypoint(s: string): WaypointData {
  const [x, z, r, a] = s.split(',');
  return {
    x: decodeCoord(x),
    z: decodeCoord(z),
    rotation: decodeRotation(r),
    animation: ANIM_DECODE[a] || 'idle'
  };
}

/**
 * Player path: "playerId:waypoint1>waypoint2>waypoint3"
 * Most plays only need 2-3 waypoints (start, middle, end)
 */
function encodePlayerPath(playerId: string, waypoints: WaypointData[]): string {
  const waypointStrs = waypoints.map(encodeWaypoint);
  return `${playerId}:${waypointStrs.join('>')}`;
}

function decodePlayerPath(s: string): { id: string; waypoints: WaypointData[] } {
  const [id, pathStr] = s.split(':');
  const waypoints = pathStr.split('>').map(decodeWaypoint);
  return { id, waypoints };
}

/**
 * Ball trajectory: "x1,y1,z1>x2,y2,z2>..."
 * Usually just 2-3 points (snap, apex, landing)
 */
function encodeBallPath(points: Array<[number, number, number]>): string {
  return points.map(([x, y, z]) => 
    `${encodeCoord(x)},${encodeCoord(y)},${encodeCoord(z)}`
  ).join('>');
}

function decodeBallPath(s: string): Array<[number, number, number]> {
  return s.split('>').map(point => {
    const [x, y, z] = point.split(',');
    return [decodeCoord(x), decodeCoord(y), decodeCoord(z)];
  }) as Array<[number, number, number]>;
}

/**
 * Complete ultra-compact play encoding:
 * Format: "Outcome|Duration|BallPath|PlayerPaths|Events"
 * Example: "T|50|2ee,0,2ee>2ee,3c,5dc|o1:2ee,2ee,0,i>2ee,5dc,1s,s;o2:...|snap,throw,catch"
 */
export interface UltraCompactPlay {
  /** Outcome code + duration: "T50" = touchdown in 50 ticks */
  meta: string;
  /** Ball trajectory waypoints */
  ball: string;
  /** Player paths separated by ; */
  players: string;
  /** Events separated by commas */
  events?: string;
  /** Human readable summary */
  summary: string;
}

export interface ExpandedPlayerPath {
  id: string;
  waypoints: WaypointData[];
}

export interface UltraCompactData {
  outcome: string;
  summary: string;
  timeElapsed: number;
  ballPath: Array<[number, number, number]>;
  playerPaths: ExpandedPlayerPath[];
  events: string[];
}

/**
 * Encode simulation to ultra-compact format
 */
export function encodeUltraCompact(data: {
  outcome: 'touchdown' | 'tackle' | 'incomplete' | 'interception' | 'turnover';
  summary: string;
  timeElapsed: number; // in seconds
  ballPath: Array<[number, number, number]>; // 2-3 waypoints
  playerPaths: Array<{ id: string; waypoints: WaypointData[] }>; // 2-3 waypoints per player
  events: string[];
}): string {
  const outcomeCode = OUTCOME_CODES[data.outcome];
  const duration = Math.round(data.timeElapsed * 10); // Store as deciseconds to save space
  
  const meta = `${outcomeCode}${duration.toString(36)}`;
  const ball = encodeBallPath(data.ballPath);
  const players = data.playerPaths.map(p => encodePlayerPath(p.id, p.waypoints)).join(';');
  const events = data.events.join(',');
  
  // Format: meta|ball|players|events|summary
  return `${meta}|${ball}|${players}|${events}|${data.summary}`;
}

/**
 * Decode ultra-compact format back to structured data
 */
export function decodeUltraCompact(encoded: string): UltraCompactData {
  const parts = encoded.split('|');
  
  if (parts.length < 4) {
    throw new Error('Invalid ultra-compact format');
  }
  
  const [meta, ball, players, events, ...summaryParts] = parts;
  
  // Parse meta: first char is outcome, rest is duration in base36
  const outcomeCode = meta[0];
  const duration = parseInt(meta.slice(1), 36) / 10; // Convert deciseconds back to seconds
  
  const outcome = OUTCOME_DECODE[outcomeCode];
  const ballPath = decodeBallPath(ball);
  const playerPaths = players.split(';').map(decodePlayerPath);
  const eventList = events ? events.split(',') : [];
  const summary = summaryParts.join('|'); // Rejoin in case summary had pipes
  
  return {
    outcome,
    summary,
    timeElapsed: duration,
    ballPath,
    playerPaths,
    events: eventList
  };
}

/**
 * Expand ultra-compact data to keyframes for interpolation
 * This converts waypoints to timed keyframes
 */
export function expandToKeyframes(data: UltraCompactData): {
  outcome: string;
  summary: string;
  timeElapsed: number;
  keyframes: Array<{
    t: number;
    b: [number, number, number];
    p: Array<[string, number, number, number, string]>;
    e?: string[];
  }>;
} {
  // Speed up animations by 33% (reduce time by 25%)
  const adjustedTime = data.timeElapsed * 0.75;
  const totalTicks = Math.round(adjustedTime * 10); // 10 ticks per second
  const keyframes: Array<{
    t: number;
    b: [number, number, number];
    p: Array<[string, number, number, number, string]>;
    e?: string[];
  }> = [];
  
  // Determine keyframe times based on waypoints
  // Distribute ticks evenly across waypoints
  const ballWaypoints = data.ballPath.length;
  const ticksPerSegment = totalTicks / (ballWaypoints - 1);
  
  for (let i = 0; i < ballWaypoints; i++) {
    const tick = Math.round(i * ticksPerSegment);
    const ballPos = data.ballPath[i];
    
    // For each player, interpolate to this tick
    const players: Array<[string, number, number, number, string]> = [];
    
    for (const playerPath of data.playerPaths) {
      const waypoints = playerPath.waypoints;
      const playerSegments = waypoints.length - 1;
      
      if (playerSegments === 0) {
        // Only one waypoint, use it for all ticks
        const w = waypoints[0];
        players.push([playerPath.id, w.x, w.z, w.rotation, w.animation]);
      } else {
        // Find which segment this tick falls into
        const playerTicksPerSegment = totalTicks / playerSegments;
        const segmentIndex = Math.min(Math.floor(tick / playerTicksPerSegment), playerSegments - 1);
        
        // Use waypoint at this segment
        const w = waypoints[segmentIndex];
        players.push([playerPath.id, w.x, w.z, w.rotation, w.animation]);
      }
    }
    
    // Events at tick 0
    const events = tick === 0 ? data.events : undefined;
    
    keyframes.push({
      t: tick,
      b: ballPos,
      p: players,
      e: events
    });
  }
  
  return {
    outcome: data.outcome as any,
    summary: data.summary,
    timeElapsed: adjustedTime, // Use the sped-up time
    keyframes
  };
}

/**
 * Calculate size reduction
 */
export function calculateSavings(original: string, compact: string): {
  originalSize: number;
  compactSize: number;
  savings: number;
  ratio: number;
} {
  const originalSize = new Blob([original]).size;
  const compactSize = new Blob([compact]).size;
  
  return {
    originalSize,
    compactSize,
    savings: originalSize - compactSize,
    ratio: compactSize / originalSize
  };
}

/**
 * Example ultra-compact play:
 * "T5a|2ee,0,2ee>2ee,3c,5dc>2ee,0,6jk|o1:2ee,2dq,0,i>2ee,2dq,1s,s>2ee,5dc,1s,s;o2:2ee,2ci,0,i>2ee,2ci,0,i;d1:2hs,34o,a0,b>2hs,3e8,a0,s>2hs,45g,a0,k|snap,handoff,tackle|QB hands off to RB, gains 8 yards before tackle"
 * 
 * This encodes:
 * - Touchdown in 50 ticks
 * - Ball path with 3 waypoints
 * - 3 players with 2-3 waypoints each
 * - 3 events
 * - Summary
 * 
 * Total: ~200 chars vs 1000+ chars in compressed keyframes
 */
