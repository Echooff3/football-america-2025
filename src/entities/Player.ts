import * as BABYLON from 'babylonjs';
import type { PlayerState } from '../data/types';

export class Player {
  public mesh: BABYLON.Mesh;
  public id: string;
  private material: BABYLON.StandardMaterial;

  constructor(id: string, scene: BABYLON.Scene, color: BABYLON.Color3, startPos: { x: number, z: number }) {
    this.id = id;
    // Create a box for the player
    this.mesh = BABYLON.MeshBuilder.CreateBox(id, { height: 2, width: 1, depth: 1 }, scene);
    this.mesh.position.x = startPos.x;
    this.mesh.position.z = startPos.z;
    this.mesh.position.y = 1; // Half height

    this.material = new BABYLON.StandardMaterial(id + "_mat", scene);
    this.material.diffuseColor = color;
    this.mesh.material = this.material;
  }

  public update(state: PlayerState) {
    this.mesh.position.x = state.x;
    this.mesh.position.z = state.z;
    this.mesh.rotation.y = state.rotation;
    
    // In the future, we can handle animations here based on state.animation
  }

  public dispose() {
    this.mesh.dispose();
    this.material.dispose();
  }
}
