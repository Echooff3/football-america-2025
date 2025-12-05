import * as BABYLON from 'babylonjs';
import { Player } from '../entities/Player';
import { Ball } from '../entities/Ball';
import type { SimulationResult, PlayerState, Playbook } from '../data/types';
import playbookData from '../data/playbook.json';

const playbook = playbookData as Playbook;

export class Game {
  private canvas: HTMLCanvasElement;
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.ArcRotateCamera;
  private fieldTexture!: BABYLON.Texture;
  
  private players: Map<string, Player> = new Map();
  private ball: Ball;
  
  private simulationData: SimulationResult | null = null;
  private isPlaying: boolean = false;
  private playbackTime: number = 0;
  private playbackSpeed: number = 1.0;
  private totalDuration: number = 0;
  private ticksPerSecond: number = 10; // Assumed from AI prompt
  private ballViewMode: boolean = true;
  private lastBallPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();
  private confettiSystem: BABYLON.ParticleSystem | null = null;
  private lineOfScrimmageZ: number = 0; // Z offset based on ball position (yard line)

  public onTimeUpdate: ((time: number, total: number) => void) | null = null;
  public onPlaybackComplete: ((outcome: string) => void) | null = null;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new BABYLON.Engine(this.canvas, true);
    this.scene = this.createScene();
    this.ball = new Ball(this.scene);
    
    // Initialize players (11 vs 11)
    this.initializePlayers();

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });

    // Register the update loop
    this.scene.onBeforeRenderObservable.add(() => {
      if (this.isPlaying && this.simulationData) {
        const dt = this.engine.getDeltaTime() / 1000;
        this.playbackTime += dt * this.playbackSpeed;
        
        if (this.playbackTime >= this.totalDuration) {
          this.playbackTime = this.totalDuration;
          this.isPlaying = false;
          
          // Trigger playback complete callback with outcome
          if (this.onPlaybackComplete && this.simulationData) {
            this.onPlaybackComplete(this.simulationData.outcome);
          }
        }
        
        this.applyFrame(this.playbackTime);
        
        // Update ball view camera if enabled
        this.updateBallViewCamera();
        
        if (this.onTimeUpdate) {
          this.onTimeUpdate(this.playbackTime, this.totalDuration);
        }
      }
    });
  }

  private createScene(): BABYLON.Scene {
    const scene = new BABYLON.Scene(this.engine);
    
    // Camera
    this.camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 4, 50, BABYLON.Vector3.Zero(), scene);
    this.camera.attachControl(this.canvas, true);
    
    // Light
    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Ground (Field)
    // Field dimensions: 120 yards total (100 yard field + 2x10 yard endzones)
    // Width: 53.3 yards (53 1/3 yards)
    // Texture: endzones are 141px each, 10-yard markers are 96px apart
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 53.3, height: 120 }, scene);
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    this.fieldTexture = new BABYLON.Texture("/field.jpg", scene);
    this.fieldTexture.wAng = Math.PI / 2; // Rotate 90 degrees (default: home on offense)
    groundMat.diffuseTexture = this.fieldTexture;
    ground.material = groundMat;

    return scene;
  }

  private initializePlayers() {
    // Offense (Blue) - default to pro_set formation
    const defaultOffenseFormation = playbook.formations.offense['pro_set'];
    for (let i = 1; i <= 11; i++) {
      const id = `off_${i}`;
      const pos = defaultOffenseFormation?.positions[id] || { x: -5 + i, z: -5 };
      this.players.set(id, new Player(id, this.scene, BABYLON.Color3.Blue(), { x: pos.x, z: pos.z }));
    }
    
    // Defense (Red) - default to 4-3 formation
    const defaultDefenseFormation = playbook.formations.defense['4-3'];
    for (let i = 1; i <= 11; i++) {
      const id = `def_${i}`;
      const pos = defaultDefenseFormation?.positions[id] || { x: -5 + i, z: 5 };
      this.players.set(id, new Player(id, this.scene, BABYLON.Color3.Red(), { x: pos.x, z: pos.z }));
    }
  }

  /**
   * Set players to their formation positions (instant)
   */
  public setFormation(offenseFormationName: string, defenseFormationName: string) {
    const offenseFormation = playbook.formations.offense[offenseFormationName] || playbook.formations.offense['pro_set'];
    const defenseFormation = playbook.formations.defense[defenseFormationName] || playbook.formations.defense['4-3'];
    
    // Update offense positions (with line of scrimmage offset)
    for (let i = 1; i <= 11; i++) {
      const id = `off_${i}`;
      const player = this.players.get(id);
      const pos = offenseFormation.positions[id];
      if (player && pos) {
        player.update({
          id,
          x: pos.x,
          z: pos.z + this.lineOfScrimmageZ,
          rotation: 0,
          animation: 'idle'
        });
      }
    }
    
    // Update defense positions (with line of scrimmage offset)
    for (let i = 1; i <= 11; i++) {
      const id = `def_${i}`;
      const player = this.players.get(id);
      const pos = defenseFormation.positions[id];
      if (player && pos) {
        player.update({
          id,
          x: pos.x,
          z: pos.z + this.lineOfScrimmageZ,
          rotation: Math.PI, // Face toward offense
          animation: 'idle'
        });
      }
    }
    
    // Reset ball position to line of scrimmage
    this.ball.update({ x: 0, y: 0, z: this.lineOfScrimmageZ }, { x: 0, y: 0, z: 0 });
  }

  /**
   * Animate players to their formation positions over a duration
   * @param offenseFormationName - Name of the offense formation
   * @param defenseFormationName - Name of the defense formation
   * @param durationSeconds - How long the animation should take
   * @returns Promise that resolves when animation is complete
   */
  public animateToFormation(offenseFormationName: string, defenseFormationName: string, durationSeconds: number = 0.5): Promise<void> {
    return new Promise((resolve) => {
      const offenseFormation = playbook.formations.offense[offenseFormationName] || playbook.formations.offense['pro_set'];
      const defenseFormation = playbook.formations.defense[defenseFormationName] || playbook.formations.defense['4-3'];
      
      // Stop any active confetti from previous play
      this.stopConfetti();
      
      // Reset camera to center on the line of scrimmage
      this.camera.target = new BABYLON.Vector3(0, 0, this.lineOfScrimmageZ);
      this.camera.alpha = -Math.PI / 2; // Default angle looking at field
      this.camera.beta = Math.PI / 4; // 45 degree angle from above
      this.camera.radius = 50; // Default distance
      
      // Store start positions for all players
      const startPositions: Map<string, { x: number; z: number; rotation: number }> = new Map();
      
      // Get current positions for offense
      for (let i = 1; i <= 11; i++) {
        const id = `off_${i}`;
        const player = this.players.get(id);
        if (player) {
          startPositions.set(id, {
            x: player.mesh.position.x,
            z: player.mesh.position.z,
            rotation: player.mesh.rotation.y
          });
        }
      }
      
      // Get current positions for defense
      for (let i = 1; i <= 11; i++) {
        const id = `def_${i}`;
        const player = this.players.get(id);
        if (player) {
          startPositions.set(id, {
            x: player.mesh.position.x,
            z: player.mesh.position.z,
            rotation: player.mesh.rotation.y
          });
        }
      }
      
      // Store ball start position
      const ballStart = {
        x: this.ball.mesh.position.x,
        y: this.ball.mesh.position.y,
        z: this.ball.mesh.position.z
      };
      
      // Animation state
      let elapsed = 0;
      const durationMs = durationSeconds * 1000;
      
      // Create animation observer
      const observer = this.scene.onBeforeRenderObservable.add(() => {
        const dt = this.engine.getDeltaTime();
        elapsed += dt;
        
        const t = Math.min(elapsed / durationMs, 1);
        // Ease out cubic for smooth deceleration
        const easedT = 1 - Math.pow(1 - t, 3);
        
        // Animate offense players
        for (let i = 1; i <= 11; i++) {
          const id = `off_${i}`;
          const player = this.players.get(id);
          const start = startPositions.get(id);
          const targetPos = offenseFormation.positions[id];
          
          if (player && start && targetPos) {
            player.update({
              id,
              x: BABYLON.Scalar.Lerp(start.x, targetPos.x, easedT),
              z: BABYLON.Scalar.Lerp(start.z, targetPos.z + this.lineOfScrimmageZ, easedT),
              rotation: BABYLON.Scalar.Lerp(start.rotation, 0, easedT),
              animation: 'sprint'
            });
          }
        }
        
        // Animate defense players
        for (let i = 1; i <= 11; i++) {
          const id = `def_${i}`;
          const player = this.players.get(id);
          const start = startPositions.get(id);
          const targetPos = defenseFormation.positions[id];
          
          if (player && start && targetPos) {
            player.update({
              id,
              x: BABYLON.Scalar.Lerp(start.x, targetPos.x, easedT),
              z: BABYLON.Scalar.Lerp(start.z, targetPos.z + this.lineOfScrimmageZ, easedT),
              rotation: BABYLON.Scalar.Lerp(start.rotation, Math.PI, easedT),
              animation: 'sprint'
            });
          }
        }
        
        // Animate ball to line of scrimmage
        this.ball.update(
          {
            x: BABYLON.Scalar.Lerp(ballStart.x, 0, easedT),
            y: BABYLON.Scalar.Lerp(ballStart.y, 0, easedT),
            z: BABYLON.Scalar.Lerp(ballStart.z, this.lineOfScrimmageZ, easedT)
          },
          { x: 0, y: 0, z: 0 }
        );
        
        // Check if animation is complete
        if (t >= 1) {
          // Set final positions and idle animation
          this.setFormation(offenseFormationName, defenseFormationName);
          
          // Remove observer
          this.scene.onBeforeRenderObservable.remove(observer);
          resolve();
        }
      });
    });
  }

  /**
   * Set the field orientation based on which team has possession
   * @param homeOnOffense - true if home team (P1) is on offense, false if on defense
   */
  public setFieldOrientation(homeOnOffense: boolean) {
    if (homeOnOffense) {
      // Home on offense - default orientation (90 degrees)
      this.fieldTexture.wAng = Math.PI / 2;
    } else {
      // Home on defense - flip 180 degrees (270 degrees total)
      this.fieldTexture.wAng = (Math.PI / 2) + Math.PI;
    }
    
    // Update player colors based on possession
    this.setTeamColors(homeOnOffense);
  }

  /**
   * Set team colors based on which team has possession
   * @param homeOnOffense - true if home team is on offense
   */
  private setTeamColors(homeOnOffense: boolean) {
    // Home team is always blue, away team is always red
    // When home is on offense: offense players = blue, defense players = red
    // When home is on defense (away on offense): offense players = red, defense players = blue
    const offenseColor = homeOnOffense ? BABYLON.Color3.Blue() : BABYLON.Color3.Red();
    const defenseColor = homeOnOffense ? BABYLON.Color3.Red() : BABYLON.Color3.Blue();
    
    // Update offense player colors
    for (let i = 1; i <= 11; i++) {
      const player = this.players.get(`off_${i}`);
      if (player) {
        player.setColor(offenseColor);
      }
    }
    
    // Update defense player colors
    for (let i = 1; i <= 11; i++) {
      const player = this.players.get(`def_${i}`);
      if (player) {
        player.setColor(defenseColor);
      }
    }
  }

  /**
   * Set the line of scrimmage based on ball position
   * @param yardLine - Ball position from 0-100 (0=own end zone, 50=midfield, 100=opponent end zone)
   * @param _homeOnOffense - Unused, kept for API compatibility
   */
  public setLineOfScrimmage(yardLine: number, _homeOnOffense: boolean) {
    // Field Z-axis: -50 to +50, center at 0
    // The field texture is rotated 180° when away team is on offense,
    // which visually flips the end zones. The coordinate mapping stays the same:
    //   yardLine 0 = own end zone = Z -50
    //   yardLine 50 = midfield = Z 0
    //   yardLine 100 = opponent's end zone = Z +50
    // The texture flip handles the visual representation, so we use the same
    // formula regardless of who's on offense.
    this.lineOfScrimmageZ = yardLine - 50;
  }

  public loadSimulation(result: SimulationResult) {
    this.simulationData = result;
    this.playbackTime = 0;
    this.isPlaying = false;
    
    // Calculate total duration
    const maxTick = result.frames[result.frames.length - 1].tick;
    this.totalDuration = maxTick / this.ticksPerSecond;
    
    // Reset to first frame
    this.applyFrame(0);
  }

  public play() {
    if (this.simulationData) {
      this.isPlaying = true;
    }
  }

  public pause() {
    this.isPlaying = false;
  }

  public scrub(time: number) {
    this.playbackTime = Math.max(0, Math.min(time, this.totalDuration));
    this.applyFrame(this.playbackTime);
    if (this.onTimeUpdate) {
      this.onTimeUpdate(this.playbackTime, this.totalDuration);
    }
  }

  /**
   * Enable or disable ball view mode (camera follows behind the ball)
   */
  public setBallViewMode(enabled: boolean) {
    this.ballViewMode = enabled;
    
    if (enabled) {
      // Switch to ball follow mode - camera will update in render loop
      this.updateBallViewCamera();
    } else {
      // Reset to free-roaming camera
      this.camera.target = BABYLON.Vector3.Zero();
    }
  }

  /**
   * Update camera to follow behind the ball
   */
  private updateBallViewCamera() {
    if (!this.ballViewMode) return;
    
    const ballPos = this.ball.mesh.position.clone();
    
    // Calculate direction of ball movement
    const direction = ballPos.subtract(this.lastBallPosition);
    
    // If ball is moving, orient camera behind the direction of movement
    if (direction.length() > 0.01) {
      // Calculate the angle to position camera behind the ball's movement
      const angle = Math.atan2(direction.x, direction.z);
      this.camera.alpha = -angle - Math.PI / 2; // Position camera behind
    }
    
    // Set camera to look at ball position (slightly above)
    this.camera.target = new BABYLON.Vector3(ballPos.x, ballPos.y + 1, ballPos.z);
    
    // Keep camera at a reasonable distance and angle
    this.camera.beta = Math.PI / 4; // 45 degree angle from above
    this.camera.radius = 20; // Distance from ball
    
    // Store last position for direction calculation
    this.lastBallPosition = ballPos.clone();
  }

  private applyFrame(time: number) {
    if (!this.simulationData) return;

    const currentTick = time * this.ticksPerSecond;
    const frames = this.simulationData.frames;
    
    // Find surrounding frames
    let frameA = frames[0];
    let frameB = frames[frames.length - 1];
    
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].tick <= currentTick && frames[i+1].tick >= currentTick) {
        frameA = frames[i];
        frameB = frames[i+1];
        break;
      }
    }

    // Interpolation factor (0 to 1)
    const range = frameB.tick - frameA.tick;
    const t = range === 0 ? 0 : (currentTick - frameA.tick) / range;

    // Update Players
    this.players.forEach((player, id) => {
      const stateA = frameA.players.find(p => p.id === id);
      const stateB = frameB.players.find(p => p.id === id);

      if (stateA && stateB) {
        const interpolatedState: PlayerState = {
          id: id,
          x: BABYLON.Scalar.Lerp(stateA.x, stateB.x, t),
          z: BABYLON.Scalar.Lerp(stateA.z, stateB.z, t) + this.lineOfScrimmageZ,
          rotation: BABYLON.Scalar.Lerp(stateA.rotation, stateB.rotation, t),
          animation: stateA.animation // No interpolation for enum, take previous
        };
        player.update(interpolatedState);
      }
    });

    // Update Ball
    const ballA = frameA.ball;
    const ballB = frameB.ball;
    
    this.ball.update(
      {
        x: BABYLON.Scalar.Lerp(ballA.x, ballB.x, t),
        y: BABYLON.Scalar.Lerp(ballA.y, ballB.y, t),
        z: BABYLON.Scalar.Lerp(ballA.z, ballB.z, t) + this.lineOfScrimmageZ
      },
      {
        x: 0, y: 0, z: 0 // Rotation interpolation omitted for brevity
      }
    );
  }

  /**
   * Trigger touchdown celebration - move camera to ball and spawn confetti
   */
  public celebrateTouchdown() {
    // Get ball position
    const ballPos = this.ball.mesh.position.clone();
    
    // Find the closest offensive player to the ball (likely the scorer)
    let closestPlayer: Player | null = null;
    let closestDistance = Infinity;
    
    for (let i = 1; i <= 11; i++) {
      const player = this.players.get(`off_${i}`);
      if (player) {
        const dist = BABYLON.Vector3.Distance(
          new BABYLON.Vector3(player.mesh.position.x, 0, player.mesh.position.z),
          new BABYLON.Vector3(ballPos.x, 0, ballPos.z)
        );
        if (dist < closestDistance) {
          closestDistance = dist;
          closestPlayer = player;
        }
      }
    }
    
    // Position to focus on (ball or closest player)
    const focusPos = closestPlayer ? closestPlayer.mesh.position.clone() : ballPos;
    
    // Move camera to focus on the touchdown
    this.camera.target = new BABYLON.Vector3(focusPos.x, focusPos.y + 1, focusPos.z);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = Math.PI / 3; // Lower angle to see player better
    this.camera.radius = 15; // Closer view
    
    // Create confetti particle system
    this.spawnConfetti(focusPos);
  }

  /**
   * Spawn confetti particle effect at a position
   */
  private spawnConfetti(position: BABYLON.Vector3) {
    // Dispose existing confetti if any
    if (this.confettiSystem) {
      this.confettiSystem.dispose();
      this.confettiSystem = null;
    }
    
    // Create particle system
    const confetti = new BABYLON.ParticleSystem("confetti", 500, this.scene);
    
    // Use a simple texture (we'll create a procedural one)
    const confettiTexture = new BABYLON.DynamicTexture("confettiTex", 64, this.scene, false);
    const ctx = confettiTexture.getContext();
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 64, 64);
    confettiTexture.update();
    confetti.particleTexture = confettiTexture;
    
    // Emission point - above the player
    confetti.emitter = new BABYLON.Vector3(position.x, position.y + 3, position.z);
    
    // Emission box
    confetti.minEmitBox = new BABYLON.Vector3(-2, 0, -2);
    confetti.maxEmitBox = new BABYLON.Vector3(2, 2, 2);
    
    // Colors - multiple bright colors for confetti
    confetti.color1 = new BABYLON.Color4(1, 0.2, 0.2, 1); // Red
    confetti.color2 = new BABYLON.Color4(0.2, 0.5, 1, 1); // Blue
    confetti.colorDead = new BABYLON.Color4(1, 1, 0, 0); // Yellow fade
    
    // Add color variation
    confetti.addColorGradient(0, new BABYLON.Color4(1, 0.8, 0, 1)); // Gold
    confetti.addColorGradient(0.25, new BABYLON.Color4(0.2, 1, 0.2, 1)); // Green
    confetti.addColorGradient(0.5, new BABYLON.Color4(1, 0.2, 0.8, 1)); // Pink
    confetti.addColorGradient(0.75, new BABYLON.Color4(0.2, 0.8, 1, 1)); // Cyan
    confetti.addColorGradient(1, new BABYLON.Color4(1, 1, 1, 0)); // White fade out
    
    // Size
    confetti.minSize = 0.1;
    confetti.maxSize = 0.3;
    
    // Size over lifetime - flutter effect
    confetti.addSizeGradient(0, 0.3);
    confetti.addSizeGradient(0.5, 0.2);
    confetti.addSizeGradient(1, 0.1);
    
    // Lifetime
    confetti.minLifeTime = 2;
    confetti.maxLifeTime = 4;
    
    // Emission rate
    confetti.emitRate = 150;
    
    // Direction - upward burst then fall
    confetti.direction1 = new BABYLON.Vector3(-3, 8, -3);
    confetti.direction2 = new BABYLON.Vector3(3, 12, 3);
    
    // Gravity - make confetti fall
    confetti.gravity = new BABYLON.Vector3(0, -5, 0);
    
    // Angular speed for spinning/tumbling effect
    confetti.minAngularSpeed = -Math.PI * 2;
    confetti.maxAngularSpeed = Math.PI * 2;
    
    // Initial speed
    confetti.minEmitPower = 2;
    confetti.maxEmitPower = 5;
    
    // Blend mode for nice visuals
    confetti.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    
    // Start the system
    confetti.start();
    this.confettiSystem = confetti;
    
    // Stop emitting after 2 seconds, let particles finish
    setTimeout(() => {
      if (this.confettiSystem) {
        this.confettiSystem.stop();
      }
    }, 2000);
    
    // Dispose after all particles are gone
    setTimeout(() => {
      if (this.confettiSystem) {
        this.confettiSystem.dispose();
        this.confettiSystem = null;
      }
    }, 6000);
  }

  /**
   * Stop and clean up any active confetti
   */
  public stopConfetti() {
    if (this.confettiSystem) {
      this.confettiSystem.stop();
      this.confettiSystem.dispose();
      this.confettiSystem = null;
    }
  }
}
