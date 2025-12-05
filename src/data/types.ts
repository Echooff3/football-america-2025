import { z } from 'zod';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Rotation {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  x: number;
  z: number;
  rotation: number; // Y-axis rotation in radians
  animation: "idle" | "sprint" | "backpedal" | "throw" | "catch" | "tackle" | "fall" | "block";
}

export interface SimulationFrame {
  tick: number;
  ball: {
    x: number;
    y: number;
    z: number;
    rotation: Rotation;
  };
  players: PlayerState[];
  events: string[];
}

export interface SimulationResult {
  outcome: "touchdown" | "tackle" | "incomplete" | "interception" | "turnover";
  summary: string;
  timeElapsed?: number; // seconds elapsed during the play (defaults to 15 if not provided)
  frames: SimulationFrame[];
}

export interface PlayRole {
  position: string;
  offset: { x: number; z: number };
  assignment: string;
  targetVelocity?: number; // Target velocity for offensive players (yards per second)
  route?: { action: string; target?: { x: number; z: number } | string }[];
}

export interface Play {
  id: string;
  name: string;
  side: "offense" | "defense";
  type: string;
  formation: string;
  description: string;
  roles: PlayRole[];
}

// Formation position definition
export interface FormationPosition {
  x: number;
  z: number;
  role: string;
}

// Formation definition with all 11 positions
export interface Formation {
  description: string;
  positions: Record<string, FormationPosition>;
}

// All formations for a side (offense or defense)
export interface FormationSet {
  [formationName: string]: Formation;
}

// Playbook with formations
export interface Playbook {
  playbookName: string;
  formations: {
    offense: FormationSet;
    defense: FormationSet;
  };
  plays: Play[];
}

// Zod Schema for OpenRouter validation
export const SimulationSchema = z.object({
  outcome: z.enum(["touchdown", "tackle", "incomplete", "interception", "turnover"]),
  summary: z.string(),
  frames: z.array(z.object({
    tick: z.number(),
    ball: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
      rotation: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number()
      }).optional().default({ x: 0, y: 0, z: 0 })
    }),
    players: z.array(z.object({
      id: z.string(),
      x: z.number(),
      z: z.number(),
      rotation: z.number(),
      animation: z.enum(["idle", "sprint", "backpedal", "throw", "catch", "tackle", "fall", "block"])
    })),
    events: z.array(z.string()).optional().default([])
  }))
});

export interface GameHistoryEntry {
  id?: number;
  timestamp: number;
  offensePlay: Play;
  defensePlay: Play;
  result: SimulationResult;
  gameState?: GameState;
  yardsGained?: number; // Yards gained on this play (stored for accurate history)
}

export interface GameState {
  down: number; // 1-4
  yardsToGo: number; // yards needed for first down
  ballPosition: number; // yard line (0-100, 50 is midfield)
  homeScore: number;
  awayScore: number;
  possession: 'home' | 'away';
  quarter: number;
  timeRemaining: number; // seconds remaining in current quarter (300 = 5 minutes)
}

