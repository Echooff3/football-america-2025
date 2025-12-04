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

  public onTimeUpdate: ((time: number, total: number) => void) | null = null;

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
        }
        
        this.applyFrame(this.playbackTime);
        
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
    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 53.3, height: 100 }, scene);
    const groundMat = new BABYLON.StandardMaterial("groundMat", scene);
    this.fieldTexture = new BABYLON.Texture("/src/assets/field.jpg", scene);
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
   * Set players to their formation positions
   */
  public setFormation(offenseFormationName: string, defenseFormationName: string) {
    const offenseFormation = playbook.formations.offense[offenseFormationName] || playbook.formations.offense['pro_set'];
    const defenseFormation = playbook.formations.defense[defenseFormationName] || playbook.formations.defense['4-3'];
    
    // Update offense positions
    for (let i = 1; i <= 11; i++) {
      const id = `off_${i}`;
      const player = this.players.get(id);
      const pos = offenseFormation.positions[id];
      if (player && pos) {
        player.update({
          id,
          x: pos.x,
          z: pos.z,
          rotation: 0,
          animation: 'idle'
        });
      }
    }
    
    // Update defense positions
    for (let i = 1; i <= 11; i++) {
      const id = `def_${i}`;
      const player = this.players.get(id);
      const pos = defenseFormation.positions[id];
      if (player && pos) {
        player.update({
          id,
          x: pos.x,
          z: pos.z,
          rotation: Math.PI, // Face toward offense
          animation: 'idle'
        });
      }
    }
    
    // Reset ball position
    this.ball.update({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
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
          z: BABYLON.Scalar.Lerp(stateA.z, stateB.z, t),
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
        z: BABYLON.Scalar.Lerp(ballA.z, ballB.z, t)
      },
      {
        x: 0, y: 0, z: 0 // Rotation interpolation omitted for brevity
      }
    );
  }
}
