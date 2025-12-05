/**
 * Adapter to convert ultra-compact waypoint format to the existing
 * compressed keyframe format used by interpolation.ts
 */

import type { CompressedSimulation } from './interpolation';

export interface UltraCompactResponse {
  outcome: 'touchdown' | 'tackle' | 'incomplete' | 'interception' | 'turnover';
  yardsGained: number;
  timeElapsed: number;
  summary: string;
  ballPath: Array<[number, number, number]>;
  playerPaths: Array<{
    id: string;
    waypoints: Array<{
      x: number;
      z: number;
      rotation: number;
      animation: 'idle' | 'sprint' | 'backpedal' | 'throw' | 'catch' | 'tackle' | 'fall' | 'block';
    }>;
  }>;
  events: string[];
}

/**
 * Convert ultra-compact waypoint format to compressed keyframes
 * This generates 3-5 keyframes from the 2-4 waypoints per entity
 */
export function ultraCompactToKeyframes(data: UltraCompactResponse): CompressedSimulation {
  // Speed up animations by 33% (reduce time by 25%)
  const adjustedTime = data.timeElapsed * 0.75;
  const totalTicks = Math.round(adjustedTime * 10); // 10 ticks per second
  
  // Determine number of keyframes based on ball path
  const numKeyframes = data.ballPath.length;
  const keyframes: Array<{
    t: number;
    b: [number, number, number];
    p: Array<[string, number, number, number, string]>;
    e?: string[];
  }> = [];
  
  // Generate keyframes at evenly spaced intervals
  for (let i = 0; i < numKeyframes; i++) {
    const t = i === 0 ? 0 : Math.round((i / (numKeyframes - 1)) * totalTicks);
    const ballPos = data.ballPath[i];
    
    // For each player, find the appropriate waypoint
    const players: Array<[string, number, number, number, string]> = [];
    
    for (const playerPath of data.playerPaths) {
      const waypoints = playerPath.waypoints;
      
      // Map keyframe index to waypoint index
      let waypointIndex: number;
      if (waypoints.length === 1) {
        waypointIndex = 0;
      } else {
        // Distribute waypoints across keyframes
        waypointIndex = Math.min(
          Math.round((i / (numKeyframes - 1)) * (waypoints.length - 1)),
          waypoints.length - 1
        );
      }
      
      const waypoint = waypoints[waypointIndex];
      players.push([
        playerPath.id,
        waypoint.x,
        waypoint.z,
        waypoint.rotation,
        waypoint.animation
      ]);
    }
    
    // Add events to first keyframe
    const events = i === 0 ? data.events : undefined;
    
    keyframes.push({
      t,
      b: ballPos,
      p: players,
      e: events
    });
  }
  
  return {
    outcome: data.outcome,
    summary: data.summary,
    timeElapsed: adjustedTime, // Use the sped-up time
    keyframes
  };
}

/**
 * Example usage in AI prompt:
 * 
 * Instead of asking for 6-10 keyframes at ticks 0,5,10,15..., ask for:
 * "Generate 2-3 waypoints per player showing start, middle (if needed), and end positions.
 *  System will interpolate smooth movement between waypoints."
 * 
 * Benefits:
 * - 60-70% fewer tokens in response
 * - Easier for LLM to reason about paths
 * - More natural "where does player go" thinking
 * - Still produces smooth interpolated animation
 */
