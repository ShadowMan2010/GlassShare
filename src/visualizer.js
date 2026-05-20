import * as THREE from 'three';

let scene, camera, renderer;
let mainMesh, wireframeMesh, particleSystem;
let currentStatus = 'IDLE'; // IDLE, CONNECTING, TRANSFERRING, COMPLETED
let rotationSpeed = 0.005;
let particleSpeed = 0.002;
let targetScale = 1;
let currentScale = 1;
let time = 0;

// Setup the scene
export function initVisualizer() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 5;

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  container.appendChild(renderer.domElement);

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const pointLight1 = new THREE.PointLight(0xa855f7, 2, 10);
  pointLight1.position.set(2, 2, 2);
  scene.add(pointLight1);

  const pointLight2 = new THREE.PointLight(0x06b6d4, 2, 10);
  pointLight2.position.set(-2, -2, 2);
  scene.add(pointLight2);

  // Core 3D Geometry: An icosahedron (representing the connection node)
  const geometry = new THREE.IcosahedronGeometry(1.4, 1);
  
  // Outer glowing physical mesh (glassy effect)
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x9333ea,
    roughness: 0.1,
    metalness: 0.1,
    transmission: 0.6, // Glass transparency
    ior: 1.5,
    thickness: 1.0,
    transparent: true,
    opacity: 0.65,
    wireframe: false,
    flatShading: true
  });
  
  mainMesh = new THREE.Mesh(geometry, material);
  scene.add(mainMesh);

  // Internal wireframe mesh for technical feel
  const wireframeGeom = new THREE.IcosahedronGeometry(1.41, 1);
  const wireframeMat = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    wireframe: true,
    transparent: true,
    opacity: 0.4
  });
  wireframeMesh = new THREE.Mesh(wireframeGeom, wireframeMat);
  scene.add(wireframeMesh);

  // Particles floating around
  const particleCount = 120;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const scales = new Float32Array(particleCount);
  const randomSpeeds = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    // Generate particles in a spherical shell around the center mesh
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2.0 * Math.PI;
    const phi = Math.acos(2.0 * v - 1.0);
    const r = 2.0 + Math.random() * 1.5; // Radius between 2.0 and 3.5

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    scales[i] = Math.random() * 0.08 + 0.02;
    randomSpeeds[i] = Math.random() * 0.02 + 0.005;
  }

  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  // Custom circular glowing particle map
  const pCanvas = document.createElement('canvas');
  pCanvas.width = 16;
  pCanvas.height = 16;
  const ctx = pCanvas.getContext('2d');
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.5, 'rgba(6, 182, 212, 0.5)');
  grad.addColorStop(1, 'rgba(6, 182, 212, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  const pTexture = new THREE.CanvasTexture(pCanvas);

  const particleMaterial = new THREE.PointsMaterial({
    size: 0.15,
    map: pTexture,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.8
  });

  particleSystem = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particleSystem);

  // Resize listener
  window.addEventListener('resize', onWindowResize);

  // Start loop
  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Set status and adjust variables
export function setVisualizerStatus(status) {
  currentStatus = status;
  const stateLabel = document.getElementById('visualizer-state');
  const subtextLabel = document.getElementById('visualizer-subtext');

  if (stateLabel) stateLabel.textContent = status;

  switch (status) {
    case 'IDLE':
      rotationSpeed = 0.004;
      particleSpeed = 0.002;
      targetScale = 1.0;
      mainMesh.material.color.setHex(0x9333ea); // Purple
      wireframeMesh.material.color.setHex(0x06b6d4); // Cyan
      if (subtextLabel) subtextLabel.textContent = 'Ready to transfer files';
      break;

    case 'CONNECTING':
      rotationSpeed = 0.015;
      particleSpeed = 0.01;
      targetScale = 1.2;
      mainMesh.material.color.setHex(0x3b82f6); // Blue
      wireframeMesh.material.color.setHex(0x06b6d4); // Cyan
      if (subtextLabel) subtextLabel.textContent = 'Establishing secure WebRTC tunnel...';
      break;

    case 'TRANSFERRING':
      rotationSpeed = 0.04;
      particleSpeed = 0.03;
      targetScale = 1.35;
      mainMesh.material.color.setHex(0xa855f7); // Glowing purple
      wireframeMesh.material.color.setHex(0x10b981); // Neon green lines
      if (subtextLabel) subtextLabel.textContent = 'Transferring file chunks...';
      break;

    case 'COMPLETED':
      rotationSpeed = 0.002;
      particleSpeed = 0.001;
      targetScale = 1.7; // Instant swell
      mainMesh.material.color.setHex(0x10b981); // Solid Emerald Green
      wireframeMesh.material.color.setHex(0xffffff); // White highlight
      if (subtextLabel) subtextLabel.textContent = 'Transfer successful!';
      
      // Auto return to IDLE after 2.5 seconds
      setTimeout(() => {
        if (currentStatus === 'COMPLETED') {
          setVisualizerStatus('IDLE');
        }
      }, 2500);
      break;
      
    case 'ERROR':
      rotationSpeed = 0.005;
      particleSpeed = 0.001;
      targetScale = 0.9;
      mainMesh.material.color.setHex(0xef4444); // Warning Red
      wireframeMesh.material.color.setHex(0xf59e0b); // Amber
      if (subtextLabel) subtextLabel.textContent = 'Connection interrupted';
      
      setTimeout(() => {
        if (currentStatus === 'ERROR') {
          setVisualizerStatus('IDLE');
        }
      }, 3500);
      break;
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  time += 0.01;

  if (mainMesh && wireframeMesh) {
    // Smooth scaling transition
    currentScale += (targetScale - currentScale) * 0.1;
    mainMesh.scale.set(currentScale, currentScale, currentScale);
    wireframeMesh.scale.set(currentScale * 1.01, currentScale * 1.01, currentScale * 1.01);

    // Apply rotation
    mainMesh.rotation.y += rotationSpeed;
    mainMesh.rotation.x += rotationSpeed * 0.5;

    wireframeMesh.rotation.y -= rotationSpeed * 1.2;
    wireframeMesh.rotation.x -= rotationSpeed * 0.6;

    // Pulse effects during specific states
    if (currentStatus === 'CONNECTING') {
      // Breathing scale pulse
      const pulse = 1.2 + Math.sin(time * 5) * 0.08;
      mainMesh.scale.set(pulse, pulse, pulse);
    } else if (currentStatus === 'TRANSFERRING') {
      // High-frequency jitter & rotation
      const pulse = 1.35 + Math.sin(time * 15) * 0.03;
      mainMesh.scale.set(pulse, pulse, pulse);
      
      // Fast jittery point lights
      scene.children.forEach(child => {
        if (child instanceof THREE.PointLight) {
          child.intensity = 2 + Math.sin(time * 20) * 0.8;
        }
      });
    } else if (currentStatus === 'IDLE') {
      // Gentle floating up and down
      mainMesh.position.y = Math.sin(time * 1.5) * 0.15;
      wireframeMesh.position.y = mainMesh.position.y;
    }
  }

  // Update particles
  if (particleSystem) {
    const positions = particleSystem.geometry.attributes.position.array;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      
      // Spin particles around Y axis
      const x = positions[idx];
      const z = positions[idx + 2];
      
      // Calculate angle
      let angle = Math.atan2(z, x);
      angle += particleSpeed * (1 + (i % 5) * 0.2); // Randomize speeds slightly

      const radius = Math.sqrt(x * x + z * z);
      
      positions[idx] = radius * Math.cos(angle);
      positions[idx + 2] = radius * Math.sin(angle);

      // In transferring mode, pull particles in towards the center sphere
      if (currentStatus === 'TRANSFERRING') {
        positions[idx + 1] += (Math.sin(time + i) * 0.01); // Wave motion
      } else {
        positions[idx + 1] += (Math.sin(time * 0.5 + i) * 0.002); // Slow wave motion
      }
    }
    
    particleSystem.geometry.attributes.position.needsUpdate = true;
    particleSystem.rotation.x = time * 0.05;
  }

  renderer.render(scene, camera);
}
