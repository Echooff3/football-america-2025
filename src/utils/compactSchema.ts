/**
 * Ultra-compact schema for AI responses
 * Uses waypoint-based encoding to minimize token usage
 */

export const ULTRA_COMPACT_SCHEMA = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["touchdown", "tackle", "incomplete", "complete", "interception", "turnover"],
      description: "The result of the play"
    },
    yardsGained: {
      type: "number",
      description: "Yards gained (positive) or lost (negative)"
    },
    timeElapsed: {
      type: "number",
      description: "Seconds elapsed during the play (5-40 typically)"
    },
    summary: {
      type: "string",
      description: "Brief text summary of the play"
    },
    ballPath: {
      type: "array",
      description: "Ball trajectory: 2-3 waypoints [x,y,z]. Start, peak/middle, end.",
      items: {
        type: "array",
        items: { type: "number" },
        minItems: 3,
        maxItems: 3
      },
      minItems: 2,
      maxItems: 4
    },
    playerPaths: {
      type: "array",
      description: "Each player's path as 2-3 waypoints. System interpolates between them.",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Player ID (off_1, def_1, etc)"
          },
          waypoints: {
            type: "array",
            description: "2-3 waypoints: start, middle (optional), end. Format: {x, z, rotation (radians), animation}",
            items: {
              type: "object",
              properties: {
                x: { type: "number", description: "Field X coordinate" },
                z: { type: "number", description: "Field Z coordinate (positive = downfield)" },
                rotation: { type: "number", description: "Y-axis rotation in radians" },
                animation: {
                  type: "string",
                  enum: ["idle", "sprint", "backpedal", "throw", "catch", "tackle", "fall", "block"],
                  description: "Animation state at this waypoint"
                }
              },
              required: ["x", "z", "rotation", "animation"]
            },
            minItems: 2,
            maxItems: 4
          }
        },
        required: ["id", "waypoints"]
      }
    },
    events: {
      type: "array",
      items: { type: "string" },
      description: "Key events: snap, handoff, throw, catch, tackle, touchdown, etc."
    }
  },
  required: ["outcome", "yardsGained", "timeElapsed", "summary", "ballPath", "playerPaths", "events"],
  additionalProperties: false
};

/**
 * Example ultra-compact response (for reference):
 * {
 *   "outcome": "tackle",
 *   "yardsGained": 8,
 *   "timeElapsed": 6.5,
 *   "summary": "QB hands off to HB who gains 8 yards before tackle",
 *   "ballPath": [
 *     [0, 1, -5],      // Snap position
 *     [0, 1, 3]        // Final position
 *   ],
 *   "playerPaths": [
 *     {
 *       "id": "off_1",
 *       "waypoints": [
 *         {"x": 0, "z": -5, "rotation": 0, "animation": "idle"},
 *         {"x": 0, "z": -4, "rotation": 1.57, "animation": "throw"}
 *       ]
 *     },
 *     {
 *       "id": "off_2",
 *       "waypoints": [
 *         {"x": 0, "z": -8, "rotation": 0, "animation": "idle"},
 *         {"x": 0, "z": 0, "rotation": 0, "animation": "sprint"},
 *         {"x": 0, "z": 3, "rotation": 0, "animation": "fall"}
 *       ]
 *     }
 *   ],
 *   "events": ["snap", "handoff", "tackle"]
 * }
 * 
 * This is ~400 tokens vs 1500+ for frame-by-frame keyframes
 */
