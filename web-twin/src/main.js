import { MQTTClient } from './mqttClient.js';
import { StateUpdater } from './stateUpdater.js';
import { fetchTelemetryHistory } from './influxApi.js';
import { DatabaseViewer } from './databaseViewer.js';
import { ChartsManager } from './chartsManager.js';

let scene, camera, renderer, roomLight, acIndicator;
let stateUpdater;
let dbViewer;
let chartsManager;

function initThreeScene() {
  const container = document.getElementById('scene-container');
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || Math.round(window.innerHeight * 0.75);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d14);

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(5, 4, 6);
  camera.lookAt(0, 1, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.domElement.id = 'three-canvas';
  container.appendChild(renderer.domElement);

  // Orbit Controls (if available from CDN)
  if (typeof THREE.OrbitControls !== 'undefined') {
    new THREE.OrbitControls(camera, renderer.domElement);
  }

  // Base Ambient Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambientLight);

  // Main Room Point Light (controlled by sensor)
  roomLight = new THREE.PointLight(0xffe2a0, 1.1, 15);
  roomLight.position.set(0, 3, 0);
  roomLight.castShadow = true;
  scene.add(roomLight);

  // Build Procedural Twin Room (Floor, Walls, AC unit, Table, Table Legs)
  createProceduralRoom();

  // Resize handler
  window.addEventListener('resize', () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || Math.round(window.innerHeight * 0.75);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  animate();
}

function createProceduralRoom() {
  // Floor
  const floorGeo = new THREE.PlaneGeometry(6, 6);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.85 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back Wall
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1e232e, roughness: 0.9 });
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
  const acMat = new THREE.MeshStandardMaterial({ color: 0xe6e9ef, roughness: 0.35 });
  const acUnit = new THREE.Mesh(acGeo, acMat);
  acUnit.position.set(0, 2.7, -2.8);
  scene.add(acUnit);

  // Thermal state indicator on AC unit
  const indGeo = new THREE.BoxGeometry(0.8, 0.04, 0.02);
  const indMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.6
  });
  acIndicator = new THREE.Mesh(indGeo, indMat);
  acIndicator.position.set(0, 2.52, -2.62);
  scene.add(acIndicator);

  // Center Table Top
  const tableTopGeo = new THREE.BoxGeometry(2.2, 0.08, 1.2);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x382c24, roughness: 0.7 });
  const tableTop = new THREE.Mesh(tableTopGeo, tableMat);
  tableTop.position.set(0, 0.8, 0);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  scene.add(tableTop);

  // Table Legs (4 Kaki Meja)
  const legHeight = 0.76;
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1f232b, roughness: 0.45, metalness: 0.4 });
  const legGeo = new THREE.BoxGeometry(0.07, legHeight, 0.07);
  const legPositions = [
    [0.98, 0.48],
    [-0.98, 0.48],
    [0.98, -0.48],
    [-0.98, -0.48]
  ];

  legPositions.forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, legHeight / 2, lz);
    leg.castShadow = true;
    leg.receiveShadow = true;
    scene.add(leg);
  });

  // Sensor Node on the desk (ESP32 node marker)
  const sensorGeo = new THREE.BoxGeometry(0.24, 0.08, 0.18);
  const sensorMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, emissive: 0x0f766e, emissiveIntensity: 0.25 });
  const sensorNode = new THREE.Mesh(sensorGeo, sensorMat);
  sensorNode.position.set(0.6, 0.88, 0.2);
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

  // Initialize Charts Manager for temperature and light graph (right side)
  chartsManager = new ChartsManager({
    tempCanvasId: 'chart-temp',
    lightCanvasId: 'chart-light',
    maxPoints: 30
  });

  // Initialize Database Table Viewer at bottom of website
  dbViewer = new DatabaseViewer({
    tableBodyId: 'db-table-body',
    rowCountId: 'db-row-count',
    lastUpdatedId: 'db-last-updated',
    syncDotId: 'db-sync-dot',
    rangeSelectId: 'db-range-select',
    refreshBtnId: 'db-refresh-btn',
    exportBtnId: 'db-export-btn',
    maxRecords: 200
  });

  // Connect MQTT for real-time telemetry
  const mqttClient = new MQTTClient();
  mqttClient.onMessage((telemetry) => {
    stateUpdater.updateDashboard(telemetry);
    stateUpdater.update3DScene(telemetry);
    dbViewer.addLiveRecord(telemetry);
    chartsManager.addLivePoint(telemetry);
  });
  mqttClient.connect();

  // Query InfluxDB telemetry history function
  async function loadDatabaseData(rangeWindow = '-1h') {
    dbViewer.setLoading(true);
    try {
      const history = await fetchTelemetryHistory(rangeWindow);
      if (history && history.length > 0) {
        dbViewer.loadInfluxHistory(history);
        chartsManager.loadHistory(history);
      }
    } catch (e) {
      console.debug('InfluxDB initial load bypassed:', e.message);
    } finally {
      dbViewer.setLoading(false);
    }
  }

  // Hook database UI events
  dbViewer.onRangeChange((selectedRange) => {
    loadDatabaseData(selectedRange);
  });

  dbViewer.onRefresh((selectedRange) => {
    loadDatabaseData(selectedRange);
  });

  // Initial load from InfluxDB
  await loadDatabaseData('-1h');
});
