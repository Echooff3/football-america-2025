import * as BABYLON from 'babylonjs';

export class Ball {
  public mesh: BABYLON.Mesh;
  private material: BABYLON.StandardMaterial;

  constructor(scene: BABYLON.Scene) {
    // Create a sphere (oblong sphere approximation for now, just a sphere)
    this.mesh = BABYLON.MeshBuilder.CreateSphere("ball", { diameter: 0.5 }, scene);
    this.mesh.position.y = 2.5; // Above player blocks (height 2)
    this.mesh.scaling.x = 1.5; // Make it oblong

    this.material = new BABYLON.StandardMaterial("ball_mat", scene);
    this.material.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.1); // Brown
    this.mesh.material = this.material;
  }

  public update(position: { x: number, y: number, z: number }, rotation: { x: number, y: number, z: number }) {
    this.mesh.position.x = position.x;
    this.mesh.position.y = position.y;
    this.mesh.position.z = position.z;
    
    this.mesh.rotation.x = rotation.x;
    this.mesh.rotation.y = rotation.y;
    this.mesh.rotation.z = rotation.z;
  }
}
