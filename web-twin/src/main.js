// ponytail: pure ES module 3D scene initialization with procedural room fallback if GLTF model is missing
// Ceiling: procedural geometry handles basic room twin without external asset load latency; upgrade to GLTF loader for high-fidelity CAD/BIM

import { MQTTClient } from './mqttClient.js';
import { StateUpdater } from './stateUpdater.js';
import { fetchTelemetryHistory } from './influxApi.js';

let scene, camera, renderer, roomLight, acIndicator;
let stateUpdater;

function initThreeScene() {
  const container = document.getElementById('scene-container');
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1117);

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(5, 4, 6);
  camera.lookAt(0, 1, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Orbit Controls (if available from CDN)
  if (typeof THREE.OrbitControls !== 'undefined') {
    new THREE.OrbitControls(camera, renderer.domElement);
  }

  // Base Ambient Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Main Room Point Light (controlled by sensor)
  roomLight = new THREE.PointLight(0xffe2a0, 1.2, 15);
  roomLight.position.set(0, 3, 0);
  roomLight.castShadow = true;
  scene.add(roomLight);

  // Build Procedural Twin Room (Floor, Walls, AC unit, Table)
  createProceduralRoom();

  // Resize handler
  window.addEventListener('resize', () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}

function createProceduralRoom() {
  // Floor
  const floorGeo = new THREE.PlaneGeometry(6, 6);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back Wall
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x272f3d, roughness: 0.9 });
  const backWallGeo = new THREE.PlaneGeometry(6, 3.5);
  const backWall = new THREE.Mesh(backWallGeo, wallMat);
  backWall.position.set(0, 1.75, -3);
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Side Wall
  const sideWallGeo = new THREE.PlaneGeometry(6, 3.5);
  const sideWall = new THREE.Mesh(sideWallGeo, wallMat);
  sideWall.position.set(-3, 1.75, 0);
  sideWall.rotation.y = Math.PI / 2;
  sideWall.receiveShadow = true;
  scene.add(sideWall);

  // AC Indoor Unit on the back wall
  const acGeo = new THREE.BoxGeometry(1.6, 0.45, 0.35);
  const acMat = new THREE.MeshStandardMaterial({ color: 0xf5f6fa, roughness: 0.3 });
  const acUnit = new THREE.Mesh(acGeo, acMat);
  acUnit.position.set(0, 2.7, -2.8);
  scene.add(acUnit);

  // Thermal state LED / glow indicator on AC unit
  const indGeo = new THREE.BoxGeometry(0.8, 0.05, 0.02);
  const indMat = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,
    emissive: 0x0088cc,
    emissiveIntensity: 0.8
  });
  acIndicator = new THREE.Mesh(indGeo, indMat);
  acIndicator.position.set(0, 2.52, -2.62);
  scene.add(acIndicator);

  // Center Table / Workstation
  const tableTopGeo = new THREE.BoxGeometry(2.2, 0.08, 1.2);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x3d312a, roughness: 0.7 });
  const tableTop = new THREE.Mesh(tableTopGeo, tableMat);
  tableTop.position.set(0, 0.8, 0);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  scene.add(tableTop);

  // Sensor Node on the desk (ESP32 node marker)
  const sensorGeo = new THREE.BoxGeometry(0.25, 0.1, 0.2);
  const sensorMat = new THREE.MeshStandardMaterial({ color: 0x10ac84, emissive: 0x10ac84, emissiveIntensity: 0.3 });
  const sensorNode = new THREE.Mesh(sensorGeo, sensorMat);
  sensorNode.position.set(0.6, 0.89, 0.2);
  scene.add(sensorNode);
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// MAIN ENTRYPOINT
document.addEventListener('DOMContentLoaded', async () => {
  initThreeScene();

  // Initialize State Updater
  stateUpdater = new StateUpdater({
    roomLight,
    acIndicator
  });

  // Connect MQTT
  const mqttClient = new MQTTClient();
  mqttClient.onMessage((telemetry) => {
    stateUpdater.updateDashboard(telemetry);
    stateUpdater.update3DScene(telemetry);
  });
  mqttClient.connect();

  // Load initial history from InfluxDB (optional fallback)
  try {
    const history = await fetchTelemetryHistory('-30m');
    console.log(`[Main] Loaded ${history.length} historical data points from InfluxDB`);
  } catch (e) {
    console.debug('InfluxDB initial load bypassed:', e.message);
  }
});
