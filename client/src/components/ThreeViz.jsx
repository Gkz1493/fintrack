import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const CAT_CFG = {
  consumables: { color: 0x6366f1, label: 'Consumables' },
  travel:      { color: 0xf59e0b, label: 'Travel'      },
  advance:     { color: 0x10b981, label: 'Advance'     },
  overhead:    { color: 0x3b82f6, label: 'Overhead'    },
  other:       { color: 0x8b5cf6, label: 'Other'       },
};

function makeTextSprite(text, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = opts.bg || 'rgba(15,23,42,0.85)';
  ctx.beginPath();
  ctx.roundRect(8, 24, 496, 80, 16);
  ctx.fill();
  ctx.fillStyle = opts.color || '#e2e8f0';
  ctx.font = `bold ${opts.fontSize || 42}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(opts.w || 4, opts.h || 1, 1);
  return sprite;
}

export default function ThreeViz({ expenses = [], projectMode = false, onProjectClick }) {
  const mountRef    = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef    = useRef(null);
  const cameraRef   = useRef(null);
  const ctrlRef     = useRef(null);
  const animRef     = useRef(null);
  const meshesRef   = useRef([]);
  const tooltipRef  = useRef(null);

  const buildScene = useCallback(() => {
    if (!mountRef.current) return;
    const W = mountRef.current.clientWidth;
    const H = mountRef.current.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.035);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 200);
    camera.position.set(0, 10, 22);
    camera.lookAt(0, 2, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 60;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    ctrlRef.current = controls;

    scene.add(new THREE.AmbientLight(0x94a3b8, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(12, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const p1 = new THREE.PointLight(0x818cf8, 1.5, 30); p1.position.set(-8, 6, 6);  scene.add(p1);
    const p2 = new THREE.PointLight(0x38bdf8, 1.0, 30); p2.position.set( 8, 4, -6); scene.add(p2);

    const grid = new THREE.GridHelper(60, 60, 0x1e3a5f, 0x1e293b);
    grid.material.opacity = 0.4; grid.material.transparent = true;
    scene.add(grid);

    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0f1e3a, roughness: 0.8, metalness: 0.1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const starsGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 800; i++) {
      starVerts.push((Math.random()-0.5)*200, Math.random()*80+10, (Math.random()-0.5)*200);
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.6 })));

    const projects = [...new Set(expenses.map(e => e.project_name || e.project).filter(Boolean))];
    if (projects.length === 0) {
      const ring = new THREE.TorusGeometry(2, 0.15, 16, 100);
      const ringMesh = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: 0x6366f1, emissive: 0x4338ca, emissiveIntensity: 0.4 }));
      ringMesh.position.set(0, 3, 0);
      scene.add(ringMesh);
      const lbl = makeTextSprite('No expenses yet — add your first!', { fontSize: 32, w: 6, h: 1.2 });
      lbl.position.set(0, 6, 0);
      scene.add(lbl);
    } else {
      const maxTotal = Math.max(...projects.map(p =>
        expenses.filter(e => (e.project_name||e.project) === p).reduce((s,e) => s+e.total, 0)
      ));
      const scale  = maxTotal > 0 ? 10 / maxTotal : 1;
      const SPACING = projectMode ? 4 : Math.max(4, 30 / projects.length);
      const START   = -(projects.length - 1) / 2 * SPACING;

      projects.forEach((projName, idx) => {
        const projExp   = expenses.filter(e => (e.project_name||e.project) === projName);
        const projTotal = projExp.reduce((s,e) => s+e.total, 0);
        const x         = START + idx * SPACING;
        let   yOff      = 0;

        const cats = [...new Set(projExp.map(e => e.category))];
        cats.forEach(cat => {
          const catExp   = projExp.filter(e => e.category === cat);
          const catTotal = catExp.reduce((s,e) => s+e.total, 0);
          const h        = Math.max(0.3, catTotal * scale);
          const cfg      = CAT_CFG[cat] || CAT_CFG.other;

          const geo = new THREE.BoxGeometry(SPACING * 0.55, h, SPACING * 0.55);
          const mat = new THREE.MeshStandardMaterial({
            color: cfg.color, emissive: cfg.color, emissiveIntensity: 0.12,
            roughness: 0.35, metalness: 0.3,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, yOff + h / 2 + 0.01, 0);
          mesh.castShadow = true;
          mesh.userData = { project: projName, category: cat, total: catTotal, type: 'bar' };
          scene.add(mesh);
          meshesRef.current.push(mesh);

          const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });
          const edgeMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
          edgeMesh.position.copy(mesh.position);
          scene.add(edgeMesh);

          yOff += h + 0.04;
        });

        const totalH = yOff;
        const label = makeTextSprite(projName, { fontSize: 28, w: SPACING * 1.2, h: 0.9 });
        label.position.set(x, totalH + 1.2, 0);
        scene.add(label);

        const amtLabel = makeTextSprite(`₹${Math.round(projTotal/1000)}k`, { fontSize: 36, w: SPACING * 0.9, h: 0.8, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' });
        amtLabel.position.set(x, totalH + 2.3, 0);
        scene.add(amtLabel);
      });
    }

    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();

    const onPointerDown = (e) => {
      if (!onProjectClick) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width ) * 2 - 1;
      mouse.y = -((e.clientY - rect.top ) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshesRef.current);
      if (hits.length > 0) {
        const proj = hits[0].object.userData?.project;
        if (proj) { controls.autoRotate = false; onProjectClick(proj); }
      }
    };

    const onPointerMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width ) * 2 - 1;
      mouse.y = -((e.clientY - rect.top ) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshesRef.current);
      if (hits.length > 0) {
        renderer.domElement.style.cursor = 'pointer';
        const ud = hits[0].object.userData;
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${e.clientX - rect.left + 14}px`;
          tooltipRef.current.style.top  = `${e.clientY - rect.top  - 10}px`;
          tooltipRef.current.innerHTML  = `<strong>${ud.project}</strong><br/>${ud.category}: ₹${Math.round(ud.total).toLocaleString('en-IN')}`;
        }
      } else {
        renderer.domElement.style.cursor = 'grab';
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    let t = 0;
    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      t += 0.005;
      p1.position.y = 6 + Math.sin(t * 1.3) * 1.5;
      p2.position.y = 4 + Math.cos(t * 0.9) * 1.5;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight || 420;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      renderer.dispose();
      if (mountRef.current && renderer.domElement.parentNode === mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      meshesRef.current = [];
    };
  }, [expenses, projectMode, onProjectClick]);

  useEffect(() => {
    const cleanup = buildScene();
    return cleanup;
  }, [buildScene]);

  return (
    <div className="relative three-container" style={{ width: '100%', height: 420, borderRadius: '1rem', overflow: 'hidden', background: '#0f172a' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div ref={tooltipRef} style={{
        display: 'none', position: 'absolute', pointerEvents: 'none',
        background: 'rgba(15,23,42,0.92)', color: '#e2e8f0',
        borderRadius: 8, padding: '6px 10px', fontSize: 12,
        border: '1px solid rgba(99,102,241,0.4)', backdropFilter: 'blur(8px)',
        lineHeight: 1.5, whiteSpace: 'nowrap',
      }} />
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(15,23,42,0.8)', borderRadius: 8, padding: '8px 12px',
        border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)',
      }}>
        {Object.entries(CAT_CFG).map(([id, cfg]) => (
          <div key={id} className="flex items-center gap-1.5 mb-1 last:mb-0">
            <div style={{ width: 10, height: 10, borderRadius: 2, background: `#${cfg.color.toString(16).padStart(6,'0')}` }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{cfg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
