# AI Prompting Guide for Ultra-Compact Format

## Key Principle

**Ask "WHERE does the player go?" not "WHERE IS the player at time X?"**

## Good vs Bad Prompts

### ❌ BAD (Keyframe Thinking)
```
Generate positions for each player at ticks 0, 5, 10, 15, 20, 25.
For each tick, specify x, z, rotation, and animation for all 11 players.
```

**Why bad:**
- Forces temporal calculation
- Requires 11 × 6 = 66 position updates
- AI must think about "when" not "where"

### ✅ GOOD (Waypoint Thinking)
```
Generate 2-3 waypoints for each player showing their path during the play.
Specify where they start, where key actions happen, and where they end.
```

**Why good:**
- Natural spatial reasoning
- Only 11 × 2.5 = 28 position updates
- AI thinks about "path" not "time"

## Example Prompts

### For a Run Play
```
Describe the path each player takes:
- RB starts at (0, -8), receives handoff at (0, -5), runs through hole to (5, 8)
- QB starts at (0, -5), hands off at (0, -5), stays at (0, -4)
- Linemen start at formation, move 2-3 yards forward blocking
- Defenders start at formation, converge on ball carrier path

Output 2 waypoints for most players, 3 for the ball carrier.
```

### For a Pass Play
```
Describe routes and movements:
- WR1 starts at (-15, 0), runs 10-yard out to (-10, 10), catches at (x, 10)
- QB starts at (0, -5), drops back to (0, -7), throws from there
- Pass rushers start at line, push toward QB at (0, -7)

Output 2 waypoints for QB (start, throw), 3 for receivers (start, catch, after).
```

## Waypoint Count Guidelines

### 2 Waypoints (Most Players)
```
Use for:
- Linemen (start position → final block position)
- QB in pocket (start → throw position)
- Static defenders (start → pursuit position)
- Players with simple straight-line movement

Example:
{
  "id": "off_5",
  "waypoints": [
    {"x": -2, "z": 0, "rotation": 0, "animation": "block"},
    {"x": -2, "z": 3, "rotation": 0, "animation": "block"}
  ]
}
```

### 3 Waypoints (Ball Carriers, Receivers)
```
Use for:
- Ball carriers (start → break through line → final position)
- Receivers (start → catch point → after catch)
- Blitzing defenders (start → loop around blocker → QB)

Example:
{
  "id": "off_2",
  "waypoints": [
    {"x": 0, "z": -8, "rotation": 0, "animation": "sprint"},
    {"x": 2, "z": 0, "rotation": 0.5, "animation": "sprint"},
    {"x": 5, "z": 8, "rotation": 0, "animation": "fall"}
  ]
}
```

### 4 Waypoints (Rare, Complex Moves)
```
Use for:
- Double moves (route running with cuts)
- Spin moves (RB juking multiple defenders)
- Complex pursuit angles

Generally avoid - 3 is usually enough!
```

## Ball Path Examples

### Short Pass
```json
"ballPath": [
  [0, 1, -5],   // Snap at QB
  [0, 5, 3],    // Peak of throw
  [-10, 1, 8]   // Landing at receiver
]
```

### Run Play
```json
"ballPath": [
  [0, 1, -5],   // Snap
  [0, 1, -5],   // Handoff (same position)
  [5, 1, 8]     // End of run
]
```

### Deep Pass
```json
"ballPath": [
  [0, 1, -5],   // Snap
  [0, 8, 15],   // High arc
  [15, 2, 30]   // Deep catch
]
```

## System Prompt Template

```
You are a football simulation engine using WAYPOINT encoding.

OUTPUT: Generate 2-3 waypoints per player (start → middle → end).
The system will interpolate smooth movement between waypoints.

THINK SPATIALLY, NOT TEMPORALLY:
- Where does each player need to be?
- What path do they take?
- Where do key actions happen?

DON'T calculate exact positions at specific ticks.
DO describe the journey from start to finish.

Format:
{
  "playerPaths": [
    {
      "id": "off_1",
      "waypoints": [
        {"x": 0, "z": -5, "rotation": 0, "animation": "idle"},
        {"x": 0, "z": -4, "rotation": 0, "animation": "throw"}
      ]
    }
  ],
  "ballPath": [[0,1,-5], [0,5,5], [10,1,12]]
}
```

## User Prompt Template

```
Offense: {play_name} - {play_description}
Defense: {play_name} - {play_description}

Generate waypoint paths showing player movement from snap to whistle.
Use 2-3 waypoints per player. Focus on key positions, not timing.
```

## Tips for Better Results

### 1. Emphasize Spatial Over Temporal
```
✅ "QB moves from (0, -5) to (0, -4)"
❌ "QB is at (0, -4.7) at tick 8"
```

### 2. Use Natural Language
```
✅ "RB cuts left through the gap, gains 8 yards"
❌ "RB at coordinates (x: 2.3, z: 7.8) during interval 10-15"
```

### 3. Describe Actions, Not Frames
```
✅ "WR catches at (10, 8), runs to (15, 12) before tackle"
❌ "WR at (10, 8) at t=10, at (12.5, 10) at t=15, at (15, 12) at t=20"
```

### 4. Group Similar Players
```
✅ "Offensive linemen push forward 3 yards maintaining formation"
❌ Specify individual positions for each of 5 linemen
```

## Model-Specific Advice

### Small Models (< 8B params)
```
- Very explicit waypoint counts: "Use EXACTLY 2 waypoints for linemen"
- Provide coordinate examples
- Emphasize simplicity
- May need to specify "no calculations needed"
```

### Medium Models (8B-70B)
```
- Can understand "key positions" without exact count
- Good at spatial reasoning
- May want to add: "interpolation handles timing automatically"
```

### Large Models (70B+)
```
- Understand waypoint concept easily
- Can handle complex instructions
- May want to optimize: "minimize waypoints while maintaining realism"
```

## Common Mistakes to Avoid

### ❌ Asking for Too Many Waypoints
```
"Generate 5-7 waypoints per player"
→ Defeats the purpose! Use 2-3.
```

### ❌ Mixing Time and Space
```
"At 5 seconds, player should be at..."
→ Just say where, not when!
```

### ❌ Over-Specifying Paths
```
"QB steps back 0.5 yards at t=1, then 0.7 yards at t=2..."
→ Just say: "QB drops back to (0, -7)"
```

### ❌ Forgetting Interpolation
```
Trying to specify exact motion curves
→ System handles this automatically!
```

## Validation Checklist

After AI generates response, check:

- [ ] Most players have 2 waypoints
- [ ] Ball carrier / receivers have 2-3 waypoints
- [ ] No waypoint has timing information (no "t" field)
- [ ] Animations make sense at each waypoint
- [ ] Coordinates are realistic (within field bounds)
- [ ] Ball path has 2-3 points (snap, peak/middle, end)

## Example Full Prompt

```
System: You are a football AI using WAYPOINT encoding.

Generate 2-3 waypoints per player showing their path during the play.
DO NOT calculate positions at specific times.
DO describe where players start, key action positions, and where they end.

Format: {playerPaths: [{id, waypoints: [{x,z,rotation,animation}]}], ballPath}

User: 
Offense: HB Dive - Running back takes handoff up the middle
Defense: 4-3 Base - Standard run defense

Generate waypoint paths. Most players need 2 waypoints, ball carrier needs 3.
```

## Expected AI Response

```json
{
  "outcome": "tackle",
  "yardsGained": 4,
  "timeElapsed": 5.0,
  "summary": "RB takes handoff, gains 4 yards before tackle",
  "ballPath": [
    [0, 1, -5],
    [0, 1, 4]
  ],
  "playerPaths": [
    {
      "id": "off_1",
      "waypoints": [
        {"x": 0, "z": -5, "rotation": 0, "animation": "idle"},
        {"x": 0, "z": -4, "rotation": 1.57, "animation": "idle"}
      ]
    },
    {
      "id": "off_2",
      "waypoints": [
        {"x": 0, "z": -8, "rotation": 0, "animation": "sprint"},
        {"x": 0, "z": -4, "rotation": 0, "animation": "catch"},
        {"x": 0, "z": 4, "rotation": 0, "animation": "fall"}
      ]
    }
  ],
  "events": ["snap", "handoff", "tackle"]
}
```

**Notice:** 
- 2 waypoints for QB (just handoff position change)
- 3 waypoints for RB (start, handoff, tackle)
- No temporal data
- Natural spatial descriptions

---

**Key Takeaway**: Treat waypoints like giving someone directions. You don't say "at minute 3 you'll be at Main Street" - you say "go to Main Street, then turn at the bank, then you're home."
