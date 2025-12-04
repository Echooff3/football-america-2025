# Football America 2025 - Implementation Documentation

## Project Overview
This project is a web-based American Football simulation game built with **Babylon.js** for 3D rendering and **OpenRouter AI** for generating play outcomes. The user selects offensive and defensive plays, and an LLM (defaulting to `x-ai/grok-4.1-fast`) simulates the physical movement of 22 players and the ball, returning a structured JSON animation sequence.

## Implementation Details

### 1. Tech Stack
*   **Framework**: Vite + TypeScript
*   **3D Engine**: Babylon.js
*   **AI Integration**: OpenRouter API (Structured Outputs)
*   **Validation**: Zod (for validating AI JSON responses)
*   **Styling**: CSS (Vanilla)

### 2. Project Structure
```text
src/
├── components/         # (Placeholder for future React/Vue components)
├── core/
│   └── Game.ts         # Main 3D engine logic, render loop, and replay system
├── data/
│   ├── playbook.json   # Definitions for 9 Offense and 9 Defense plays
│   └── types.ts        # TypeScript interfaces and Zod schemas
├── entities/
│   ├── Player.ts       # 3D Mesh management for players (Red/Blue blocks)
│   └── Ball.ts         # 3D Mesh management for the ball
├── services/
│   └── AIService.ts    # Handles OpenRouter API calls and response parsing
├── utils/              # Helper functions
├── main.ts             # Application entry point, UI logic, and event listeners
└── style.css           # Global styles for UI overlays
```

### 3. Key Features
*   **AI-Driven Simulation**: The `AIService` constructs a prompt with the selected plays and game history. The LLM returns a frame-by-frame simulation (positions, rotations, events).
*   **Replay System**: The `Game` class implements a playback engine that uses **Linear Interpolation (Lerp)** to smooth out the movement between the discrete frames returned by the AI (assumed 10 ticks/second).
*   **Playbook**: A JSON-driven playbook system allowing for easy expansion of formations and routes.
*   **Configurable AI**: Users can supply their own OpenRouter API Key and switch models via the Settings modal.

## Setup & Run Instructions

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Start Development Server**:
    ```bash
    npm run dev
    ```

3.  **Launch**:
    Open the URL provided in the terminal (e.g., `http://localhost:5173`).

4.  **Configuration**:
    *   Click the **Settings** button in the top-left corner.
    *   Enter your **OpenRouter API Key**.
    *   (Optional) Update the Model ID (default: `x-ai/grok-4.1-fast`).
    *   Click **Save**.

## Next Steps

### 1. Visual Enhancements
*   **3D Models**: Replace the colored blocks with rigged character models (GLB/gLTF).
*   **Animations**: Map the AI's `animation` state (idle, run, throw, tackle) to actual skeletal animations.
*   **Stadium**: Add a stadium environment, crowd, and field textures (grass, yard lines).

### 2. Gameplay Depth
*   **Playmaker UI**: Create a visual editor to let users design their own plays and save them to `playbook.json`.
*   **Game State Logic**: Implement full football rules (downs, yards to go, scoring, turnovers, clock management) based on the AI's `outcome` and `events`.
*   **Camera Controls**: Improve the camera system to follow the ball or allow free-roaming.

### 3. AI Improvements
*   **Prompt Engineering**: Refine the system prompt to enforce stricter physics constraints and more realistic player behavior.
*   **Streaming**: Implement streaming responses to start the animation before the full simulation is generated (lower latency).
*   **Fine-tuning**: Eventually fine-tune a small model specifically on football physics and rules.

### 4. Multiplayer
*   **PVP**: Implement WebSockets to allow two human players to pick plays against each other.
